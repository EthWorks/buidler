import Account from "ethereumjs-account";
import {
  BN,
  bufferToHex,
  keccak256,
  KECCAK256_NULL,
  stripZeros,
  toBuffer,
} from "ethereumjs-util";
import { Map as ImmutableMap, Record as ImmutableRecord } from "immutable";
import { callbackify } from "util";

import { JsonRpcClient } from "../../jsonrpc/client";
import { PStateManager } from "../types/PStateManager";
import { StateManager } from "../types/StateManager";

import { AccountState, makeAccountState } from "./Account";
import { randomHash } from "./random";

/* tslint:disable only-buidler-error */

type State = ImmutableMap<string, ImmutableMap<keyof AccountState, any>>;

const encodeStorageKey = (address: Buffer, position: Buffer): string => {
  return `${address.toString("hex")}${stripZeros(position).toString("hex")}`;
};

const checkpointError = (method: string) =>
  new Error(`${method} called when not checkpointed`);

const notSupportedError = (method: string) =>
  new Error(`${method} is not supported when forking from remote network`);

export class ForkStateManager implements PStateManager {
  private _state: State = ImmutableMap();
  private _stateRoot: string = randomHash();
  private _stateRootToState: Map<string, State> = new Map();
  private _originalStorageCache: Map<string, Buffer> = new Map();
  private _stateCheckpoints: string[] = [];

  constructor(
    private _jsonRpcClient: JsonRpcClient,
    private _forkBlockNumber: BN
  ) {
    this._state = ImmutableMap();
  }

  public copy(): ForkStateManager {
    const fsm = new ForkStateManager(
      this._jsonRpcClient,
      this._forkBlockNumber
    );
    fsm._state = this._state;
    fsm._stateRoot = this._stateRoot;

    // because this map is append-only we don't need to copy it
    fsm._stateRootToState = this._stateRootToState;
    return fsm;
  }

  public async getAccount(address: Buffer): Promise<Account> {
    const localAccount = this._state.get(bufferToHex(address));

    const localNonce = localAccount?.get("nonce");
    const localBalance = localAccount?.get("balance");
    const localCode = localAccount?.get("code");

    const nonce =
      localNonce !== undefined
        ? toBuffer(localNonce)
        : await this._jsonRpcClient.getTransactionCount(
            address,
            this._forkBlockNumber
          );
    const balance =
      localBalance !== undefined
        ? toBuffer(localBalance)
        : await this._jsonRpcClient.getBalance(address, this._forkBlockNumber);
    const code =
      localCode !== undefined
        ? toBuffer(localCode)
        : await this._jsonRpcClient.getCode(address, this._forkBlockNumber);

    const codeHash = keccak256(code);
    // We ignore stateRoot since we found that it is not used anywhere of interest to us
    return new Account({ nonce, balance, codeHash });
  }

  public async putAccount(address: Buffer, account: Account): Promise<void> {
    // Because the vm only ever modifies the nonce, balance and codeHash using this
    // method we ignore the stateRoot property
    const hexAddress = bufferToHex(address);
    let localAccount = this._state.get(hexAddress) ?? makeAccountState();
    localAccount = localAccount
      .set("nonce", bufferToHex(account.nonce))
      .set("balance", bufferToHex(account.balance));

    // Code is set to empty string here to prevent unnecessary
    // JsonRpcClient.getCode calls in getAccount method
    if (account.codeHash.equals(KECCAK256_NULL)) {
      localAccount = localAccount.set("code", "0x");
    }
    this._state = this._state.set(hexAddress, localAccount);
  }

  public touchAccount(address: Buffer): void {
    // We don't do anything here. See cleanupTouchedAccounts for explanation
  }

  public async putContractCode(address: Buffer, value: Buffer): Promise<void> {
    const hexAddress = bufferToHex(address);
    const account = (this._state.get(hexAddress) ?? makeAccountState()).set(
      "code",
      bufferToHex(value)
    );
    this._state = this._state.set(hexAddress, account);
  }

  public async getContractCode(address: Buffer): Promise<Buffer> {
    const localCode = this._state.get(bufferToHex(address))?.get("code");
    if (localCode !== undefined) {
      return toBuffer(localCode);
    }
    return this._jsonRpcClient.getCode(address, this._forkBlockNumber);
  }

  public async getContractStorage(
    address: Buffer,
    key: Buffer
  ): Promise<Buffer> {
    const account = this._state.get(bufferToHex(address));
    const cleared = account?.get("storageCleared") ?? false;
    const localValue = account?.get("storage").get(bufferToHex(key));
    if (localValue !== undefined) {
      return toBuffer(localValue);
    }
    if (cleared) {
      return toBuffer(new Array(32).fill(0));
    }
    return this._jsonRpcClient.getStorageAt(
      address,
      key,
      this._forkBlockNumber
    );
  }

  public async getOriginalContractStorage(
    address: Buffer,
    key: Buffer
  ): Promise<Buffer> {
    const storageKey = encodeStorageKey(address, key);
    const cachedValue = this._originalStorageCache.get(storageKey);
    if (cachedValue !== undefined) {
      return cachedValue;
    }
    const value = await this.getContractStorage(address, key);
    this._originalStorageCache.set(storageKey, value);
    return value;
  }

  public async putContractStorage(
    address: Buffer,
    key: Buffer,
    value: Buffer
  ): Promise<void> {
    const hexAddress = bufferToHex(address);
    let account = this._state.get(hexAddress) ?? makeAccountState();
    account = account.set(
      "storage",
      account.get("storage").set(bufferToHex(key), bufferToHex(value))
    );
    this._state = this._state.set(hexAddress, account);
  }

  public async clearContractStorage(address: Buffer): Promise<void> {
    const hexAddress = bufferToHex(address);
    let account = this._state.get(hexAddress) ?? makeAccountState();
    account = account
      .set("storageCleared", true)
      .set("storage", ImmutableMap());
    this._state = this._state.set(hexAddress, account);
  }

  public async checkpoint(): Promise<void> {
    const stateRoot = await this.getStateRoot();
    this._stateCheckpoints.push(bufferToHex(stateRoot));
  }

  public async commit(): Promise<void> {
    if (this._stateCheckpoints.length === 0) {
      throw checkpointError("commit");
    }
    this._stateCheckpoints.pop();
  }

  public async revert(): Promise<void> {
    const checkpointedRoot = this._stateCheckpoints.pop();
    if (checkpointedRoot === undefined) {
      throw checkpointError("revert");
    }
    await this.setStateRoot(toBuffer(checkpointedRoot));
  }

  public async getStateRoot(): Promise<Buffer> {
    if (this._stateRootToState.get(this._stateRoot) !== this._state) {
      this._stateRoot = randomHash();
      this._stateRootToState.set(this._stateRoot, this._state);
    }
    return toBuffer(this._stateRoot);
  }

  public async setStateRoot(stateRoot: Buffer): Promise<void> {
    const newRoot = bufferToHex(stateRoot);
    const state = this._stateRootToState.get(newRoot);
    if (state === undefined) {
      throw new Error("Unknown state root");
    }
    this._stateRoot = newRoot;
    this._state = state;
  }

  public async dumpStorage(address: Buffer): Promise<Record<string, string>> {
    throw notSupportedError("dumpStorage");
  }

  public async hasGenesisState(): Promise<boolean> {
    throw notSupportedError("hasGenesisState");
  }

  public async generateCanonicalGenesis(): Promise<void> {
    throw notSupportedError("generateCanonicalGenesis");
  }

  public async generateGenesis(initState: any): Promise<void> {
    throw notSupportedError("generateGenesis");
  }

  public async accountIsEmpty(address: Buffer): Promise<boolean> {
    const account = await this.getAccount(address);
    // From https://eips.ethereum.org/EIPS/eip-161
    // An account is considered empty when it has no code and zero nonce and zero balance.
    return (
      new BN(account.nonce).eqn(0) &&
      new BN(account.balance).eqn(0) &&
      account.codeHash.equals(KECCAK256_NULL)
    );
  }

  public async cleanupTouchedAccounts(): Promise<void> {
    // We do not do anything here, because cleaning accounts only affects the
    // stateRoot. Since the stateRoot is fake anyway there is no need to
    // perform this operation.
  }

  // NOTE: this method is PUBLIC despite the naming convention of buidler
  public _clearOriginalStorageCache(): void {
    this._originalStorageCache = new Map();
  }

  public asStateManager(): StateManager {
    return {
      copy: () => this.copy().asStateManager(),
      getAccount: callbackify(this.getAccount.bind(this)),
      putAccount: callbackify(this.putAccount.bind(this)),
      touchAccount: this.touchAccount.bind(this),
      putContractCode: callbackify(this.putContractCode.bind(this)),
      getContractCode: callbackify(this.getContractCode.bind(this)),
      getContractStorage: callbackify(this.getContractStorage.bind(this)),
      getOriginalContractStorage: callbackify(
        this.getOriginalContractStorage.bind(this)
      ),
      putContractStorage: callbackify(this.putContractStorage.bind(this)),
      clearContractStorage: callbackify(this.clearContractStorage.bind(this)),
      checkpoint: callbackify(this.checkpoint.bind(this)),
      commit: callbackify(this.commit.bind(this)),
      revert: callbackify(this.revert.bind(this)),
      getStateRoot: callbackify(this.getStateRoot.bind(this)),
      setStateRoot: callbackify(this.setStateRoot.bind(this)),
      dumpStorage: callbackify(this.dumpStorage.bind(this)),
      hasGenesisState: callbackify(this.hasGenesisState.bind(this)),
      generateCanonicalGenesis: callbackify(
        this.generateCanonicalGenesis.bind(this)
      ),
      generateGenesis: callbackify(this.generateGenesis.bind(this)),
      accountIsEmpty: callbackify(this.accountIsEmpty.bind(this)),
      cleanupTouchedAccounts: callbackify(
        this.cleanupTouchedAccounts.bind(this)
      ),
      _clearOriginalStorageCache: this._clearOriginalStorageCache.bind(this),
    };
  }
}
