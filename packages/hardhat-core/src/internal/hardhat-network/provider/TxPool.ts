import { Transaction } from "ethereumjs-tx";
import { BN, bufferToHex, toBuffer } from "ethereumjs-util";
import { List as ImmutableList, Record as ImmutableRecord } from "immutable";

import {
  AddressToTransactions,
  makePoolState,
  makeSerializedTransaction,
  OrderedTransaction,
  PoolState,
  SenderTransactions,
  SerializedTransaction,
} from "./PoolState";
import { PStateManager } from "./types/PStateManager";
import { bnToHex } from "./utils/bnToHex";
import { reorganizeTransactionsLists } from "./utils/reorganizeTransactionsLists";

// tslint:disable only-hardhat-error

export function serializeTransaction(
  tx: OrderedTransaction
): SerializedTransaction {
  const fields = tx.data.raw.map((field) => bufferToHex(field));
  const immutableFields = ImmutableList(fields);
  return makeSerializedTransaction({
    orderId: tx.orderId,
    data: immutableFields,
  });
}

export function deserializeTransaction(
  tx: SerializedTransaction
): OrderedTransaction {
  const fields = tx
    .get("data")
    .toArray()
    .map((field) => toBuffer(field));
  return {
    orderId: tx.get("orderId"),
    data: new Transaction(fields),
  };
}

export class TxPool {
  private _state: ImmutableRecord<PoolState>;
  private _snapshotIdToState = new Map<number, ImmutableRecord<PoolState>>();
  private _currentSnapshotId = -1;
  private _nextSnapshotId = 0;
  private _nextOrderId = 0;

  constructor(
    private readonly _stateManager: PStateManager,
    private _blockGasLimit: BN
  ) {
    this._state = makePoolState({
      blockGasLimit: bnToHex(this._blockGasLimit),
    });
  }

  public async addTransaction(tx: Transaction) {
    const senderNonce = await this._validateTransaction(tx);
    const txNonce = new BN(tx.nonce);

    if (txNonce.eq(senderNonce)) {
      this._addPendingTransaction(tx);
    } else {
      this._addQueuedTransaction(tx);
    }
  }

  public snapshot(): number {
    if (this._snapshotIdToState.get(this._currentSnapshotId) !== this._state) {
      this._currentSnapshotId = this._nextSnapshotId++;
      this._snapshotIdToState.set(this._currentSnapshotId, this._state);
    }
    return this._currentSnapshotId;
  }

  public revert(snapshotId: number) {
    const state = this._snapshotIdToState.get(snapshotId);
    if (state === undefined) {
      throw new Error("There's no snapshot with such ID");
    }
    this._currentSnapshotId = snapshotId;
    this._state = state;
  }

  public getPendingTransactions(): Map<string, OrderedTransaction[]> {
    const deserializedImmutableMap = this._getPending()
      .filter((txs) => txs.size > 0)
      .map((txs) => txs.map(deserializeTransaction).toJS());
    return new Map(deserializedImmutableMap.entries());
  }

  public getQueuedTransactions(): Map<string, OrderedTransaction[]> {
    const deserializedImmutableMap = this._getQueued()
      .filter((txs) => txs.size > 0)
      .map((txs) => txs.map(deserializeTransaction).toJS());
    return new Map(deserializedImmutableMap.entries());
  }

  public async getExecutableNonce(accountAddress: Buffer): Promise<BN> {
    const nonce = this._getExecutableNonces().get(bufferToHex(accountAddress));
    if (nonce === undefined) {
      const account = await this._stateManager.getAccount(accountAddress);
      return new BN(account.nonce);
    }
    return new BN(toBuffer(nonce));
  }

  public getBlockGasLimit(): BN {
    return new BN(toBuffer(this._state.get("blockGasLimit")));
  }

  public setBlockGasLimit(newLimit: BN | number) {
    if (typeof newLimit === "number") {
      newLimit = new BN(newLimit);
    }

    this._setBlockGasLimit(newLimit);
  }

  public async clean() {
    this._setPending(await this._cleanMap(this._getPending()));
    this._setQueued(await this._cleanMap(this._getQueued()));
  }

  private async _cleanMap(map: AddressToTransactions) {
    let newMap = map;
    for (const [address, txs] of map) {
      for (const tx of txs) {
        const deserializedTx = deserializeTransaction(tx);
        const txNonce = new BN(deserializedTx.data.nonce);
        const txGasLimit = new BN(deserializedTx.data.gasLimit);
        const senderAccount = await this._stateManager.getAccount(
          toBuffer(address)
        );
        const senderNonce = new BN(senderAccount.nonce);
        const senderBalance = new BN(senderAccount.balance);

        if (
          txGasLimit.gt(this.getBlockGasLimit()) ||
          txNonce.lt(senderNonce) ||
          deserializedTx.data.getUpfrontCost().gt(senderBalance)
        ) {
          newMap = this._removeTx(newMap, address, deserializedTx);
        }
      }
    }
    return newMap;
  }

  private _removeTx(
    map: AddressToTransactions,
    address: string,
    deserializedTX: OrderedTransaction
  ) {
    const accountTxs = map.get(address);
    if (accountTxs === undefined) {
      throw new Error(
        "Trying to remove a transaction from list that doesn't exist, this should never happen"
      );
    }
    const indexOfTx = accountTxs.indexOf(serializeTransaction(deserializedTX));
    return map.set(address, accountTxs.remove(indexOfTx));
  }

  private _addPendingTransaction(tx: Transaction) {
    const orderedTx = serializeTransaction({
      orderId: this._nextOrderId++,
      data: tx,
    });

    const hexSenderAddress = bufferToHex(tx.getSenderAddress());
    const accountTransactions: SenderTransactions =
      this._getPendingForAddress(hexSenderAddress) ?? ImmutableList();

    const {
      executableNonce,
      newPending,
      newQueued,
    } = reorganizeTransactionsLists(
      accountTransactions.push(orderedTx),
      this._getQueuedForAddress(hexSenderAddress) ?? ImmutableList()
    );

    this._setExecutableNonce(hexSenderAddress, executableNonce);
    this._setPendingForAddress(hexSenderAddress, newPending);
    this._setQueuedForAddress(hexSenderAddress, newQueued);
  }

  private _addQueuedTransaction(tx: Transaction) {
    const orderedTx = serializeTransaction({
      orderId: this._nextOrderId++,
      data: tx,
    });

    const hexSenderAddress = bufferToHex(tx.getSenderAddress());
    const accountTransactions: SenderTransactions =
      this._getQueuedForAddress(hexSenderAddress) ?? ImmutableList();
    this._setQueuedForAddress(
      hexSenderAddress,
      accountTransactions.push(orderedTx)
    );
  }

  private async _validateTransaction(tx: Transaction): Promise<BN> {
    const txNonce = new BN(tx.nonce);
    const senderAddress = tx.getSenderAddress(); // verifies signature so no need to check it again
    const senderNonce = await this.getExecutableNonce(senderAddress);

    // Geth returns this error if trying to create a contract and no data is provided
    if (tx.to.length === 0 && tx.data.length === 0) {
      throw new Error("contract creation without any data provided");
    }

    const senderAccount = await this._stateManager.getAccount(
      tx.getSenderAddress()
    );
    const senderBalance = new BN(senderAccount.balance);

    if (tx.getUpfrontCost().gt(senderBalance)) {
      throw new Error(
        `sender doesn't have enough funds to send tx. The upfront cost is: ${tx
          .getUpfrontCost()
          .toString()}` +
          ` and the sender's account only has: ${senderBalance.toString()}`
      );
    }

    if (txNonce.lt(senderNonce)) {
      throw new Error("Nonce too low");
    }

    const baseFee = tx.getBaseFee();
    const gasLimit = new BN(tx.gasLimit);

    if (baseFee.gt(gasLimit)) {
      throw new Error(
        `Transaction requires at least ${baseFee} gas but got ${gasLimit}`
      );
    }

    if (gasLimit.gt(this._blockGasLimit)) {
      throw new Error(
        `Transaction gas limit is ${gasLimit} and exceeds block gas limit of ${this._blockGasLimit}`
      );
    }

    return senderNonce;
  }

  private _getPending() {
    return this._state.get("pendingTransactions");
  }

  private _getQueued() {
    return this._state.get("queuedTransactions");
  }

  private _getPendingForAddress(address: string) {
    return this._getPending().get(address);
  }

  private _getQueuedForAddress(address: string) {
    return this._getQueued().get(address);
  }

  private _getExecutableNonces() {
    return this._state.get("executableNonces");
  }

  private _setPending(transactions: AddressToTransactions) {
    this._state = this._state.set("pendingTransactions", transactions);
  }

  private _setQueued(transactions: AddressToTransactions) {
    this._state = this._state.set("queuedTransactions", transactions);
  }

  private _setPendingForAddress(
    address: string,
    transactions: SenderTransactions
  ) {
    this._state = this._state.set(
      "pendingTransactions",
      this._getPending().set(address, transactions)
    );
  }

  private _setQueuedForAddress(
    address: string,
    transactions: SenderTransactions
  ) {
    this._state = this._state.set(
      "queuedTransactions",
      this._getQueued().set(address, transactions)
    );
  }

  private _setExecutableNonce(accountAddress: string, nonce: BN): void {
    this._state = this._state.set(
      "executableNonces",
      this._getExecutableNonces().set(accountAddress, bnToHex(nonce))
    );
  }

  private _setBlockGasLimit(newLimit: BN) {
    this._state = this._state.set("blockGasLimit", bnToHex(newLimit));
  }
}
