import VM from "@nomiclabs/ethereumjs-vm";
import Bloom from "@nomiclabs/ethereumjs-vm/dist/bloom";
import { EVMResult, ExecResult } from "@nomiclabs/ethereumjs-vm/dist/evm/evm";
import { ERROR } from "@nomiclabs/ethereumjs-vm/dist/exceptions";
import { RunBlockResult } from "@nomiclabs/ethereumjs-vm/dist/runBlock";
import { StateManager } from "@nomiclabs/ethereumjs-vm/dist/state";
import chalk from "chalk";
import debug from "debug";
import Common from "ethereumjs-common";
import { FakeTransaction, Transaction } from "ethereumjs-tx";
import {
  BN,
  bufferToHex,
  ECDSASignature,
  ecsign,
  hashPersonalMessage,
  privateToAddress,
  toBuffer,
} from "ethereumjs-util";
import EventEmitter from "events";

import { ForkConfig } from "../../../types";
import { BUIDLEREVM_DEFAULT_GAS_PRICE } from "../../core/config/default-config";
import { Reporter } from "../../sentry/reporter";
import { getDifferenceInSeconds } from "../../util/date";
import { createModelsAndDecodeBytecodes } from "../stack-traces/compiler-to-model";
import { CompilerInput, CompilerOutput } from "../stack-traces/compiler-types";
import { ConsoleLogger } from "../stack-traces/consoleLogger";
import { ContractsIdentifier } from "../stack-traces/contracts-identifier";
import { MessageTrace } from "../stack-traces/message-trace";
import { decodeRevertReason } from "../stack-traces/revert-reasons";
import {
  encodeSolidityStackTrace,
  SolidityError,
} from "../stack-traces/solidity-errors";
import {
  SolidityStackTrace,
  StackTraceEntryType,
} from "../stack-traces/solidity-stack-trace";
import { SolidityTracer } from "../stack-traces/solidityTracer";
import { VmTraceDecoder } from "../stack-traces/vm-trace-decoder";
import { VMTracer } from "../stack-traces/vm-tracer";

import { BuidlerBlockchain } from "./BuidlerBlockchain";
import { InvalidInputError, TransactionExecutionError } from "./errors";
import { bloomFilter, Filter, filterLogs, LATEST_BLOCK, Type } from "./filter";
import { ForkBlockchain } from "./fork/ForkBlockchain";
import { ForkStateManager } from "./fork/ForkStateManager";
import {
  CallParams,
  FilterParams,
  GenesisAccount,
  Snapshot,
  TransactionParams,
} from "./node-types";
import {
  getRpcBlock,
  getRpcReceipts,
  RpcLogOutput,
  RpcReceiptOutput,
} from "./output";
import { Block } from "./types/Block";
import { PBlockchain } from "./types/PBlockchain";
import { PStateManager } from "./types/PStateManager";
import { asPStateManager } from "./utils/asPStateManager";
import { asStateManager } from "./utils/asStateManager";
import { getCurrentTimestamp } from "./utils/getCurrentTimestamp";
import { makeCommon } from "./utils/makeCommon";
import { makeForkClient } from "./utils/makeForkClient";
import { makeForkCommon } from "./utils/makeForkCommon";
import { makeStateTrie } from "./utils/makeStateTrie";
import { putGenesisAccounts } from "./utils/putGenesisAccounts";

const log = debug("buidler:core:buidler-evm:node");

// This library's types are wrong, they don't type check
// tslint:disable-next-line no-var-requires
const ethSigUtil = require("eth-sig-util");

export const COINBASE_ADDRESS = toBuffer(
  "0xc014ba5ec014ba5ec014ba5ec014ba5ec014ba5e"
);

// tslint:disable only-buidler-error

export class BuidlerNode extends EventEmitter {
  public static async create(
    hardfork: string,
    networkName: string,
    chainId: number,
    networkId: number,
    blockGasLimit: number,
    genesisAccounts: GenesisAccount[] = [],
    solidityVersion?: string,
    allowUnlimitedContractSize?: boolean,
    initialDate?: Date,
    compilerInput?: CompilerInput,
    compilerOutput?: CompilerOutput,
    forkConfig?: ForkConfig
  ): Promise<[Common, BuidlerNode]> {
    let common;
    let stateManager: StateManager | ForkStateManager;
    let blockchain: BuidlerBlockchain | ForkBlockchain;

    if (forkConfig !== undefined) {
      const { forkClient, forkBlockNumber } = await makeForkClient(forkConfig);
      common = await makeForkCommon(forkClient, forkBlockNumber);

      stateManager = new ForkStateManager(forkClient, forkBlockNumber);
      await putGenesisAccounts(stateManager, genesisAccounts);

      blockchain = new ForkBlockchain(forkClient, forkBlockNumber, common);
    } else {
      const stateTrie = await makeStateTrie(genesisAccounts);
      common = makeCommon(
        initialDate,
        chainId,
        networkId,
        networkName,
        blockGasLimit,
        stateTrie,
        hardfork
      );

      stateManager = new StateManager({
        common,
        trie: stateTrie,
      });

      blockchain = new BuidlerBlockchain();
      const genesisBlock = new Block(null, { common });
      genesisBlock.setGenesisParams();
      await blockchain.addBlock(genesisBlock);
    }

    const vm = new VM({
      common,
      activatePrecompiles: true,
      stateManager: asStateManager(stateManager) as any,
      blockchain: blockchain.asBlockchain() as any,
      allowUnlimitedContractSize,
    });

    const node = new BuidlerNode(
      vm,
      asPStateManager(stateManager),
      blockchain,
      genesisAccounts.map((acc) => toBuffer(acc.privateKey)),
      new BN(blockGasLimit),
      solidityVersion,
      initialDate,
      compilerInput,
      compilerOutput
    );

    return [common, node];
  }

  private readonly _accountPrivateKeys: Map<string, Buffer> = new Map();

  private _blockTimeOffsetSeconds: BN = new BN(0);
  private _nextBlockTimestamp: BN = new BN(0);

  private _lastFilterId = new BN(0);
  private _filters: Map<string, Filter> = new Map();

  private _nextSnapshotId = 1; // We start in 1 to mimic Ganache
  private readonly _snapshots: Snapshot[] = [];

  private readonly _vmTracer: VMTracer;
  private readonly _vmTraceDecoder: VmTraceDecoder;
  private readonly _solidityTracer: SolidityTracer;
  private readonly _consoleLogger: ConsoleLogger = new ConsoleLogger();
  private _failedStackTraces = 0;

  private constructor(
    private readonly _vm: VM,
    private readonly _stateManager: PStateManager,
    private readonly _blockchain: PBlockchain,
    localAccounts: Buffer[],
    private readonly _blockGasLimit: BN,
    solidityVersion?: string,
    initialDate?: Date,
    compilerInput?: CompilerInput,
    compilerOutput?: CompilerOutput
  ) {
    super();

    this._initLocalAccounts(localAccounts);

    this._vmTracer = new VMTracer(this._vm, true);
    this._vmTracer.enableTracing();

    if (initialDate !== undefined) {
      this._blockTimeOffsetSeconds = new BN(
        getDifferenceInSeconds(initialDate, new Date())
      );
    }

    const contractsIdentifier = new ContractsIdentifier();
    this._vmTraceDecoder = new VmTraceDecoder(contractsIdentifier);
    this._solidityTracer = new SolidityTracer();

    if (
      solidityVersion === undefined ||
      compilerInput === undefined ||
      compilerOutput === undefined
    ) {
      return;
    }

    try {
      const bytecodes = createModelsAndDecodeBytecodes(
        solidityVersion,
        compilerInput,
        compilerOutput
      );

      for (const bytecode of bytecodes) {
        this._vmTraceDecoder.addBytecode(bytecode);
      }
    } catch (error) {
      console.warn(
        chalk.yellow(
          "The Buidler EVM tracing engine could not be initialized. Run Buidler with --verbose to learn more."
        )
      );

      log(
        "Buidler EVM tracing disabled: ContractsIdentifier failed to be initialized. Please report this to help us improve Buidler.\n",
        error
      );

      Reporter.reportError(error);
    }
  }

  public async getSignedTransaction(
    txParams: TransactionParams
  ): Promise<Transaction> {
    const tx = new Transaction(txParams, { common: this._vm._common });

    const pk = await this._getLocalAccountPrivateKey(txParams.from);
    tx.sign(pk);

    return tx;
  }

  public async _getFakeTransaction(
    txParams: TransactionParams
  ): Promise<Transaction> {
    return new FakeTransaction(txParams, { common: this._vm._common });
  }

  public async runTransactionInNewBlock(
    tx: Transaction
  ): Promise<{
    trace: MessageTrace;
    block: Block;
    blockResult: RunBlockResult;
    error?: Error;
    consoleLogMessages: string[];
  }> {
    await this._validateTransaction(tx);
    await this._notifyPendingTransaction(tx);

    const [
      blockTimestamp,
      offsetShouldChange,
      newOffset,
    ] = this._calculateTimestampAndOffset();

    const block = await this._getNextBlockTemplate(blockTimestamp);

    const needsTimestampIncrease = await this._timestampClashesWithPreviousBlockOne(
      block
    );

    if (needsTimestampIncrease) {
      await this._increaseBlockTimestamp(block);
    }

    await this._addTransactionToBlock(block, tx);

    const result = await this._vm.runBlock({
      block,
      generate: true,
      skipBlockValidation: true,
    });

    if (needsTimestampIncrease) {
      await this.increaseTime(new BN(1));
    }

    await this._saveBlockAsSuccessfullyRun(block, result);

    let vmTrace = this._vmTracer.getLastTopLevelMessageTrace();
    const vmTracerError = this._vmTracer.getLastError();
    this._vmTracer.clearLastError();

    vmTrace = this._vmTraceDecoder.tryToDecodeMessageTrace(vmTrace);

    const consoleLogMessages = await this._getConsoleLogMessages(
      vmTrace,
      vmTracerError
    );

    const error = await this._manageErrors(
      result.results[0].execResult,
      vmTrace,
      vmTracerError
    );

    if (offsetShouldChange) {
      await this.increaseTime(newOffset.sub(await this.getTimeIncrement()));
    }

    await this._resetNextBlockTimestamp();

    return {
      trace: vmTrace,
      block,
      blockResult: result,
      error,
      consoleLogMessages,
    };
  }

  public async mineEmptyBlock(timestamp: BN) {
    // need to check if timestamp is specified or nextBlockTimestamp is set
    // if it is, time offset must be set to timestamp|nextBlockTimestamp - Date.now
    // if it is not, time offset remain the same
    const [
      blockTimestamp,
      offsetShouldChange,
      newOffset,
    ] = this._calculateTimestampAndOffset(timestamp);

    const block = await this._getNextBlockTemplate(blockTimestamp);

    const needsTimestampIncrease = await this._timestampClashesWithPreviousBlockOne(
      block
    );

    if (needsTimestampIncrease) {
      await this._increaseBlockTimestamp(block);
    }

    await new Promise((resolve) => block.genTxTrie(resolve));
    block.header.transactionsTrie = block.txTrie.root;

    const previousRoot = await this._stateManager.getStateRoot();

    let result: RunBlockResult;
    try {
      result = await this._vm.runBlock({
        block,
        generate: true,
        skipBlockValidation: true,
      });

      if (needsTimestampIncrease) {
        await this.increaseTime(new BN(1));
      }

      await this._saveBlockAsSuccessfullyRun(block, result);

      if (offsetShouldChange) {
        await this.increaseTime(newOffset.sub(await this.getTimeIncrement()));
      }

      await this._resetNextBlockTimestamp();

      return result;
    } catch (error) {
      // We set the state root to the previous one. This is equivalent to a
      // rollback of this block.
      await this._stateManager.setStateRoot(previousRoot);

      throw new TransactionExecutionError(error);
    }
  }

  public async runCall(
    call: CallParams,
    runOnNewBlock: boolean
  ): Promise<{
    result: Buffer;
    trace: MessageTrace;
    error?: Error;
    consoleLogMessages: string[];
  }> {
    const tx = await this._getFakeTransaction({
      ...call,
      nonce: await this.getAccountNonce(call.from),
    });

    const result = await this._runTxAndRevertMutations(tx, runOnNewBlock);

    let vmTrace = this._vmTracer.getLastTopLevelMessageTrace();
    const vmTracerError = this._vmTracer.getLastError();
    this._vmTracer.clearLastError();

    vmTrace = this._vmTraceDecoder.tryToDecodeMessageTrace(vmTrace);

    const consoleLogMessages = await this._getConsoleLogMessages(
      vmTrace,
      vmTracerError
    );

    const error = await this._manageErrors(
      result.execResult,
      vmTrace,
      vmTracerError
    );

    return {
      result: result.execResult.returnValue,
      trace: vmTrace,
      error,
      consoleLogMessages,
    };
  }

  public async getAccountBalance(address: Buffer): Promise<BN> {
    const account = await this._stateManager.getAccount(address);
    return new BN(account.balance);
  }

  public async getAccountNonce(address: Buffer): Promise<BN> {
    const account = await this._stateManager.getAccount(address);
    return new BN(account.nonce);
  }

  public async getAccountNonceInPreviousBlock(address: Buffer): Promise<BN> {
    const account = await this._stateManager.getAccount(address);

    const latestBlock = await this.getLatestBlock();
    const latestBlockTxsFromAccount = latestBlock.transactions.filter(
      (tx: Transaction) => tx.getSenderAddress().equals(address)
    );

    return new BN(account.nonce).subn(latestBlockTxsFromAccount.length);
  }

  public async getLatestBlock(): Promise<Block> {
    return this._blockchain.getLatestBlock();
  }

  public async getLatestBlockNumber(): Promise<BN> {
    return new BN((await this.getLatestBlock()).header.number);
  }

  public async getLocalAccountAddresses(): Promise<string[]> {
    return [...this._accountPrivateKeys.keys()];
  }

  public async getBlockGasLimit(): Promise<BN> {
    return this._blockGasLimit;
  }

  public async estimateGas(
    txParams: TransactionParams
  ): Promise<{
    estimation: BN;
    trace: MessageTrace;
    error?: Error;
    consoleLogMessages: string[];
  }> {
    const tx = await this._getFakeTransaction({
      ...txParams,
      gasLimit: await this.getBlockGasLimit(),
    });

    const result = await this._runTxAndRevertMutations(tx);

    let vmTrace = this._vmTracer.getLastTopLevelMessageTrace();
    const vmTracerError = this._vmTracer.getLastError();
    this._vmTracer.clearLastError();

    vmTrace = this._vmTraceDecoder.tryToDecodeMessageTrace(vmTrace);

    const consoleLogMessages = await this._getConsoleLogMessages(
      vmTrace,
      vmTracerError
    );

    // This is only considered if the call to _runTxAndRevertMutations doesn't
    // manage errors
    if (result.execResult.exceptionError !== undefined) {
      return {
        estimation: await this.getBlockGasLimit(),
        trace: vmTrace,
        error: await this._manageErrors(
          result.execResult,
          vmTrace,
          vmTracerError
        ),
        consoleLogMessages,
      };
    }

    const initialEstimation = result.gasUsed;

    return {
      estimation: await this._correctInitialEstimation(
        txParams,
        initialEstimation
      ),
      trace: vmTrace,
      consoleLogMessages,
    };
  }

  public async getGasPrice(): Promise<BN> {
    return new BN(BUIDLEREVM_DEFAULT_GAS_PRICE);
  }

  public async getCoinbaseAddress(): Promise<Buffer> {
    return COINBASE_ADDRESS;
  }

  public async getStorageAt(address: Buffer, slot: BN): Promise<Buffer> {
    const key = slot.toArrayLike(Buffer, "be", 32);
    const data = await this._stateManager.getContractStorage(address, key);

    // TODO: The state manager returns the data as it was saved, it doesn't
    //  pad it. Technically, the storage consists of 32-byte slots, so we should
    //  always return 32 bytes. The problem is that Ganache doesn't handle them
    //  this way. We compromise a little here to ease the migration into
    //  BuidlerEVM :(

    // const EXPECTED_DATA_SIZE = 32;
    // if (data.length < EXPECTED_DATA_SIZE) {
    //   return Buffer.concat(
    //     [Buffer.alloc(EXPECTED_DATA_SIZE - data.length, 0), data],
    //     EXPECTED_DATA_SIZE
    //   );
    // }

    return data;
  }

  public async getBlockByNumber(blockNumber: BN): Promise<Block | undefined> {
    return this._blockchain.getBlock(blockNumber);
  }

  public async getBlockByHash(blockHash: Buffer): Promise<Block | undefined> {
    return this._blockchain.getBlock(blockHash);
  }

  public async getBlockByTransactionHash(
    hash: Buffer
  ): Promise<Block | undefined> {
    return this._blockchain.getBlockByTransactionHash(hash);
  }

  public async getBlockTotalDifficulty(block: Block): Promise<BN> {
    return this._blockchain.getTotalDifficulty(block.hash());
  }

  public async getCode(address: Buffer): Promise<Buffer> {
    return this._stateManager.getContractCode(address);
  }

  public async setNextBlockTimestamp(timestamp: BN) {
    this._nextBlockTimestamp = new BN(timestamp);
  }

  public async increaseTime(increment: BN) {
    this._blockTimeOffsetSeconds = this._blockTimeOffsetSeconds.add(increment);
  }

  public async getTimeIncrement(): Promise<BN> {
    return this._blockTimeOffsetSeconds;
  }

  public async getNextBlockTimestamp(): Promise<BN> {
    return this._nextBlockTimestamp;
  }

  public async getTransaction(hash: Buffer): Promise<Transaction | undefined> {
    return this._blockchain.getTransaction(hash);
  }

  public async getTransactionReceipt(
    hash: Buffer
  ): Promise<RpcReceiptOutput | undefined> {
    return this._blockchain.getTransactionReceipt(hash);
  }

  public async getPendingTransactions(): Promise<Transaction[]> {
    return [];
  }

  public async signPersonalMessage(
    address: Buffer,
    data: Buffer
  ): Promise<ECDSASignature> {
    const messageHash = hashPersonalMessage(data);
    const privateKey = await this._getLocalAccountPrivateKey(address);

    return ecsign(messageHash, privateKey);
  }

  public async signTypedData(address: Buffer, typedData: any): Promise<string> {
    const privateKey = await this._getLocalAccountPrivateKey(address);

    return ethSigUtil.signTypedData_v4(privateKey, {
      data: typedData,
    });
  }

  public async getStackTraceFailuresCount(): Promise<number> {
    return this._failedStackTraces;
  }

  public async takeSnapshot(): Promise<number> {
    const id = this._nextSnapshotId;

    // We copy all the maps here, as they may be modified
    const snapshot: Snapshot = {
      id,
      date: new Date(),
      latestBlock: await this.getLatestBlock(),
      stateRoot: await this._stateManager.getStateRoot(),
      blockTimeOffsetSeconds: new BN(this._blockTimeOffsetSeconds),
      nextBlockTimestamp: new BN(this._nextBlockTimestamp),
    };

    this._snapshots.push(snapshot);
    this._nextSnapshotId += 1;

    return id;
  }

  public async revertToSnapshot(id: number): Promise<boolean> {
    const snapshotIndex = this._getSnapshotIndex(id);
    if (snapshotIndex === undefined) {
      return false;
    }

    const snapshot = this._snapshots[snapshotIndex];

    // We compute a new offset such that
    //  now + new_offset === snapshot_date + old_offset
    const now = new Date();
    const offsetToSnapshotInMillis = snapshot.date.valueOf() - now.valueOf();
    const offsetToSnapshotInSecs = Math.ceil(offsetToSnapshotInMillis / 1000);
    const newOffset = snapshot.blockTimeOffsetSeconds.addn(
      offsetToSnapshotInSecs
    );

    // We delete all following blocks, changes the state root, and all the
    // relevant Node fields.
    //
    // Note: There's no need to copy the maps here, as snapshots can only be
    // used once
    this._blockchain.deleteLaterBlocks(snapshot.latestBlock);
    await this._stateManager.setStateRoot(snapshot.stateRoot);
    this._blockTimeOffsetSeconds = newOffset;
    this._nextBlockTimestamp = snapshot.nextBlockTimestamp;

    // We delete this and the following snapshots, as they can only be used
    // once in Ganache
    this._snapshots.splice(snapshotIndex);

    return true;
  }

  public async newFilter(
    filterParams: FilterParams,
    isSubscription: boolean
  ): Promise<BN> {
    filterParams = await this._computeFilterParams(filterParams, true);

    const filterId = this._getNextFilterId();
    this._filters.set(this._filterIdToFiltersKey(filterId), {
      id: filterId,
      type: Type.LOGS_SUBSCRIPTION,
      criteria: {
        fromBlock: filterParams.fromBlock,
        toBlock: filterParams.toBlock,
        addresses: filterParams.addresses,
        normalizedTopics: filterParams.normalizedTopics,
      },
      deadline: this._newDeadline(),
      hashes: [],
      logs: await this.getLogs(filterParams),
      subscription: isSubscription,
    });

    return filterId;
  }

  public async newBlockFilter(isSubscription: boolean): Promise<BN> {
    const block = await this.getLatestBlock();

    const filterId = this._getNextFilterId();
    this._filters.set(this._filterIdToFiltersKey(filterId), {
      id: filterId,
      type: Type.BLOCK_SUBSCRIPTION,
      deadline: this._newDeadline(),
      hashes: [bufferToHex(block.header.hash())],
      logs: [],
      subscription: isSubscription,
    });

    return filterId;
  }

  public async newPendingTransactionFilter(
    isSubscription: boolean
  ): Promise<BN> {
    const filterId = this._getNextFilterId();

    this._filters.set(this._filterIdToFiltersKey(filterId), {
      id: filterId,
      type: Type.PENDING_TRANSACTION_SUBSCRIPTION,
      deadline: this._newDeadline(),
      hashes: [],
      logs: [],
      subscription: isSubscription,
    });

    return filterId;
  }

  public async uninstallFilter(
    filterId: BN,
    subscription: boolean
  ): Promise<boolean> {
    const key = this._filterIdToFiltersKey(filterId);
    const filter = this._filters.get(key);

    if (filter === undefined) {
      return false;
    }

    if (
      (filter.subscription && !subscription) ||
      (!filter.subscription && subscription)
    ) {
      return false;
    }

    this._filters.delete(key);
    return true;
  }

  public async getFilterChanges(
    filterId: BN
  ): Promise<string[] | RpcLogOutput[] | undefined> {
    const key = this._filterIdToFiltersKey(filterId);
    const filter = this._filters.get(key);
    if (filter === undefined) {
      return undefined;
    }

    filter.deadline = this._newDeadline();
    switch (filter.type) {
      case Type.BLOCK_SUBSCRIPTION:
      case Type.PENDING_TRANSACTION_SUBSCRIPTION:
        const hashes = filter.hashes;
        filter.hashes = [];
        return hashes;
      case Type.LOGS_SUBSCRIPTION:
        const logs = filter.logs;
        filter.logs = [];
        return logs;
    }

    return undefined;
  }

  public async getFilterLogs(
    filterId: BN
  ): Promise<RpcLogOutput[] | undefined> {
    const key = this._filterIdToFiltersKey(filterId);
    const filter = this._filters.get(key);
    if (filter === undefined) {
      return undefined;
    }

    const logs = filter.logs;
    filter.logs = [];
    filter.deadline = this._newDeadline();
    return logs;
  }

  public async getLogs(filterParams: FilterParams): Promise<RpcLogOutput[]> {
    filterParams = await this._computeFilterParams(filterParams, false);
    return this._blockchain.getLogs(filterParams);
  }

  public async addCompilationResult(
    compilerVersion: string,
    compilerInput: CompilerInput,
    compilerOutput: CompilerOutput
  ): Promise<boolean> {
    let bytecodes;
    try {
      bytecodes = createModelsAndDecodeBytecodes(
        compilerVersion,
        compilerInput,
        compilerOutput
      );
    } catch (error) {
      console.warn(
        chalk.yellow(
          "The Buidler EVM tracing engine could not be updated. Run Buidler with --verbose to learn more."
        )
      );

      log(
        "ContractsIdentifier failed to be updated. Please report this to help us improve Buidler.\n",
        error
      );

      return false;
    }

    for (const bytecode of bytecodes) {
      this._vmTraceDecoder.addBytecode(bytecode);
    }

    return true;
  }

  private _getSnapshotIndex(id: number): number | undefined {
    for (const [i, snapshot] of this._snapshots.entries()) {
      if (snapshot.id === id) {
        return i;
      }

      // We already removed the snapshot we are looking for
      if (snapshot.id > id) {
        return undefined;
      }
    }

    return undefined;
  }

  private _initLocalAccounts(localAccounts: Buffer[]) {
    for (const pk of localAccounts) {
      this._accountPrivateKeys.set(bufferToHex(privateToAddress(pk)), pk);
    }
  }

  private async _getConsoleLogMessages(
    vmTrace: MessageTrace,
    vmTracerError: Error | undefined
  ): Promise<string[]> {
    if (vmTracerError !== undefined) {
      log(
        "Could not print console log. Please report this to help us improve Buidler.\n",
        vmTracerError
      );

      return [];
    }

    return this._consoleLogger.getLogMessages(vmTrace);
  }

  private async _manageErrors(
    vmResult: ExecResult,
    vmTrace: MessageTrace,
    vmTracerError?: Error
  ): Promise<SolidityError | TransactionExecutionError | undefined> {
    if (vmResult.exceptionError === undefined) {
      return undefined;
    }

    let stackTrace: SolidityStackTrace | undefined;

    try {
      if (vmTracerError !== undefined) {
        throw vmTracerError;
      }

      stackTrace = this._solidityTracer.getStackTrace(vmTrace);
    } catch (error) {
      this._failedStackTraces += 1;
      log(
        "Could not generate stack trace. Please report this to help us improve Buidler.\n",
        error
      );
    }

    const error = vmResult.exceptionError;

    if (error.error === ERROR.OUT_OF_GAS) {
      if (this._isContractTooLargeStackTrace(stackTrace)) {
        return encodeSolidityStackTrace(
          "Transaction run out of gas",
          stackTrace!
        );
      }

      return new TransactionExecutionError("Transaction run out of gas");
    }

    if (error.error === ERROR.REVERT) {
      if (vmResult.returnValue.length === 0) {
        if (stackTrace !== undefined) {
          return encodeSolidityStackTrace(
            "Transaction reverted without a reason",
            stackTrace
          );
        }

        return new TransactionExecutionError(
          "Transaction reverted without a reason"
        );
      }

      if (stackTrace !== undefined) {
        return encodeSolidityStackTrace(
          `VM Exception while processing transaction: revert ${decodeRevertReason(
            vmResult.returnValue
          )}`,
          stackTrace
        );
      }

      return new TransactionExecutionError(
        `VM Exception while processing transaction: revert ${decodeRevertReason(
          vmResult.returnValue
        )}`
      );
    }

    if (stackTrace !== undefined) {
      return encodeSolidityStackTrace("Transaction failed: revert", stackTrace);
    }

    return new TransactionExecutionError("Transaction failed: revert");
  }

  private _isContractTooLargeStackTrace(
    stackTrace: SolidityStackTrace | undefined
  ) {
    return (
      stackTrace !== undefined &&
      stackTrace.length > 0 &&
      stackTrace[stackTrace.length - 1].type ===
        StackTraceEntryType.CONTRACT_TOO_LARGE_ERROR
    );
  }

  private _calculateTimestampAndOffset(timestamp?: BN): [BN, boolean, BN] {
    let blockTimestamp: BN;
    let offsetShouldChange: boolean;
    let newOffset: BN = new BN(0);

    // if timestamp is not provided, we check nextBlockTimestamp, if it is
    // set, we use it as the timestamp instead. If it is not set, we use
    // time offset + real time as the timestamp.
    if (timestamp === undefined || timestamp.eq(new BN(0))) {
      if (this._nextBlockTimestamp.eq(new BN(0))) {
        blockTimestamp = new BN(getCurrentTimestamp()).add(
          this._blockTimeOffsetSeconds
        );
        offsetShouldChange = false;
      } else {
        blockTimestamp = new BN(this._nextBlockTimestamp);
        offsetShouldChange = true;
      }
    } else {
      offsetShouldChange = true;
      blockTimestamp = timestamp;
    }

    if (offsetShouldChange) {
      newOffset = blockTimestamp.sub(new BN(getCurrentTimestamp()));
    }

    return [blockTimestamp, offsetShouldChange, newOffset];
  }

  private async _getNextBlockTemplate(timestamp: BN): Promise<Block> {
    const block = new Block(
      {
        header: {
          gasLimit: this._blockGasLimit,
          nonce: "0x42",
          timestamp,
        },
      },
      { common: this._vm._common }
    );

    block.validate = (blockchain: any, cb: any) => cb(null);

    const latestBlock = await this.getLatestBlock();

    block.header.number = toBuffer(new BN(latestBlock.header.number).addn(1));
    block.header.parentHash = latestBlock.hash();
    block.header.difficulty = block.header
      .canonicalDifficulty(latestBlock)
      .toBuffer();
    block.header.coinbase = await this.getCoinbaseAddress();

    return block;
  }

  private async _resetNextBlockTimestamp() {
    this._nextBlockTimestamp = new BN(0);
  }

  private async _notifyPendingTransaction(tx: Transaction) {
    this._filters.forEach((filter) => {
      if (filter.type === Type.PENDING_TRANSACTION_SUBSCRIPTION) {
        const hash = bufferToHex(tx.hash(true));
        if (filter.subscription) {
          this._emitEthEvent(filter.id, hash);
          return;
        }

        filter.hashes.push(hash);
      }
    });
  }

  private async _getLocalAccountPrivateKey(sender: Buffer): Promise<Buffer> {
    const senderAddress = bufferToHex(sender);
    if (!this._accountPrivateKeys.has(senderAddress)) {
      throw new InvalidInputError(`unknown account ${senderAddress}`);
    }

    return this._accountPrivateKeys.get(senderAddress)!;
  }

  private async _addTransactionToBlock(block: Block, tx: Transaction) {
    block.transactions.push(tx);

    await new Promise((resolve) => block.genTxTrie(resolve));

    block.header.transactionsTrie = block.txTrie.root;
  }

  private async _saveBlockAsSuccessfullyRun(
    block: Block,
    runBlockResult: RunBlockResult
  ) {
    const receipts = getRpcReceipts(block, runBlockResult);

    await this._blockchain.addBlock(block);
    this._blockchain.addTransactionReceipts(receipts);

    const td = await this.getBlockTotalDifficulty(block);
    const rpcLogs: RpcLogOutput[] = [];
    for (const receipt of receipts) {
      rpcLogs.push(...receipt.logs);
    }

    this._filters.forEach((filter, key) => {
      if (filter.deadline.valueOf() < new Date().valueOf()) {
        this._filters.delete(key);
      }

      switch (filter.type) {
        case Type.BLOCK_SUBSCRIPTION:
          const hash = block.hash();
          if (filter.subscription) {
            this._emitEthEvent(filter.id, getRpcBlock(block, td, false));
            return;
          }

          filter.hashes.push(bufferToHex(hash));
          break;
        case Type.LOGS_SUBSCRIPTION:
          if (
            bloomFilter(
              new Bloom(block.header.bloom),
              filter.criteria!.addresses,
              filter.criteria!.normalizedTopics
            )
          ) {
            const logs = filterLogs(rpcLogs, filter.criteria!);
            if (logs.length === 0) {
              return;
            }

            if (filter.subscription) {
              logs.forEach((rpcLog) => {
                this._emitEthEvent(filter.id, rpcLog);
              });
              return;
            }

            filter.logs.push(...logs);
          }
          break;
      }
    });
  }

  private async _transactionWasSuccessful(tx: Transaction): Promise<boolean> {
    const block = await this.getBlockByTransactionHash(tx.hash());
    return block !== undefined;
  }

  private async _timestampClashesWithPreviousBlockOne(
    block: Block
  ): Promise<boolean> {
    const blockTimestamp = new BN(block.header.timestamp);

    const latestBlock = await this.getLatestBlock();
    const latestBlockTimestamp = new BN(latestBlock.header.timestamp);

    return latestBlockTimestamp.eq(blockTimestamp);
  }

  private async _increaseBlockTimestamp(block: Block) {
    block.header.timestamp = new BN(block.header.timestamp).addn(1).toBuffer();
  }

  private async _setBlockTimestamp(block: Block, timestamp: BN) {
    block.header.timestamp = new BN(timestamp).toBuffer();
  }

  private async _validateTransaction(tx: Transaction) {
    // Geth throws this error if a tx is sent twice
    if (await this._transactionWasSuccessful(tx)) {
      throw new InvalidInputError(
        `known transaction: ${bufferToHex(tx.hash(true)).toString()}`
      );
    }

    if (!tx.verifySignature()) {
      throw new InvalidInputError("Invalid transaction signature");
    }

    // Geth returns this error if trying to create a contract and no data is provided
    if (tx.to.length === 0 && tx.data.length === 0) {
      throw new InvalidInputError(
        "contract creation without any data provided"
      );
    }

    const expectedNonce = await this.getAccountNonce(tx.getSenderAddress());
    const actualNonce = new BN(tx.nonce);
    if (!expectedNonce.eq(actualNonce)) {
      throw new InvalidInputError(
        `Invalid nonce. Expected ${expectedNonce} but got ${actualNonce}.

If you are running a script or test, you may be sending transactions in parallel.
Using JavaScript? You probably forgot an await.

If you are using a wallet or dapp, try resetting your wallet's accounts.`
      );
    }

    const baseFee = tx.getBaseFee();
    const gasLimit = new BN(tx.gasLimit);

    if (baseFee.gt(gasLimit)) {
      throw new InvalidInputError(
        `Transaction requires at least ${baseFee} gas but got ${gasLimit}`
      );
    }

    if (gasLimit.gt(this._blockGasLimit)) {
      throw new InvalidInputError(
        `Transaction gas limit is ${gasLimit} and exceeds block gas limit of ${this._blockGasLimit}`
      );
    }
  }

  private async _correctInitialEstimation(
    txParams: TransactionParams,
    initialEstimation: BN
  ): Promise<BN> {
    let tx = await this._getFakeTransaction({
      ...txParams,
      gasLimit: initialEstimation,
    });

    if (tx.getBaseFee().gte(initialEstimation)) {
      initialEstimation = tx.getBaseFee().addn(1);

      tx = await this._getFakeTransaction({
        ...txParams,
        gasLimit: initialEstimation,
      });
    }

    const result = await this._runTxAndRevertMutations(tx);

    if (result.execResult.exceptionError === undefined) {
      return initialEstimation;
    }

    return this._binarySearchEstimation(
      txParams,
      initialEstimation,
      await this.getBlockGasLimit()
    );
  }

  private async _binarySearchEstimation(
    txParams: TransactionParams,
    highestFailingEstimation: BN,
    lowestSuccessfulEstimation: BN,
    roundNumber = 0
  ): Promise<BN> {
    if (lowestSuccessfulEstimation.lte(highestFailingEstimation)) {
      // This shouldn't happen, but we don't wan't to go into an infinite loop
      // if it ever happens
      return lowestSuccessfulEstimation;
    }

    const MAX_GAS_ESTIMATION_IMPROVEMENT_ROUNDS = 20;

    const diff = lowestSuccessfulEstimation.sub(highestFailingEstimation);

    const minDiff = highestFailingEstimation.gten(4_000_000)
      ? 50_000
      : highestFailingEstimation.gten(1_000_000)
      ? 10_000
      : highestFailingEstimation.gten(100_000)
      ? 1_000
      : highestFailingEstimation.gten(50_000)
      ? 500
      : highestFailingEstimation.gten(30_000)
      ? 300
      : 200;

    if (diff.lten(minDiff)) {
      return lowestSuccessfulEstimation;
    }

    if (roundNumber > MAX_GAS_ESTIMATION_IMPROVEMENT_ROUNDS) {
      return lowestSuccessfulEstimation;
    }

    const binSearchNewEstimation = highestFailingEstimation.add(diff.divn(2));

    const optimizedEstimation =
      roundNumber === 0
        ? highestFailingEstimation.muln(3)
        : binSearchNewEstimation;

    const newEstimation = optimizedEstimation.gt(binSearchNewEstimation)
      ? binSearchNewEstimation
      : optimizedEstimation;

    // Let other things execute
    await new Promise((resolve) => setImmediate(resolve));

    const tx = await this._getFakeTransaction({
      ...txParams,
      gasLimit: newEstimation,
    });

    const result = await this._runTxAndRevertMutations(tx);

    if (result.execResult.exceptionError === undefined) {
      return this._binarySearchEstimation(
        txParams,
        highestFailingEstimation,
        newEstimation,
        roundNumber + 1
      );
    }

    return this._binarySearchEstimation(
      txParams,
      newEstimation,
      lowestSuccessfulEstimation,
      roundNumber + 1
    );
  }

  /**
   * This function runs a transaction and reverts all the modifications that it
   * makes.
   *
   * If throwOnError is true, errors are managed locally and thrown on
   * failure. If it's false, the tx's RunTxResult is returned, and the vmTracer
   * inspected/resetted.
   */
  private async _runTxAndRevertMutations(
    tx: Transaction,
    runOnNewBlock: boolean = true
  ): Promise<EVMResult> {
    const initialStateRoot = await this._stateManager.getStateRoot();

    try {
      let blockContext;
      // if the context is to estimate gas or run calls in pending block
      if (runOnNewBlock) {
        const [
          blockTimestamp,
          offsetShouldChange,
          newOffset,
        ] = this._calculateTimestampAndOffset();

        blockContext = await this._getNextBlockTemplate(blockTimestamp);
        const needsTimestampIncrease = await this._timestampClashesWithPreviousBlockOne(
          blockContext
        );

        if (needsTimestampIncrease) {
          await this._increaseBlockTimestamp(blockContext);
        }

        // in the context of running estimateGas call, we have to do binary
        // search for the gas and run the call multiple times. Since it is
        // an approximate approach to calculate the gas, it is important to
        // run the call in a block that is as close to the real one as
        // possible, hence putting the tx to the block is good to have here.
        await this._addTransactionToBlock(blockContext, tx);
      } else {
        // if the context is to run calls with the latest block
        blockContext = await this.getLatestBlock();
      }

      return await this._vm.runTx({
        block: blockContext,
        tx,
        skipNonce: true,
        skipBalance: true,
      });
    } finally {
      await this._stateManager.setStateRoot(initialStateRoot);
    }
  }

  private async _computeFilterParams(
    filterParams: FilterParams,
    isFilter: boolean
  ): Promise<FilterParams> {
    const latestBlockNumber = await this.getLatestBlockNumber();
    const newFilterParams = { ...filterParams };

    if (newFilterParams.fromBlock === LATEST_BLOCK) {
      newFilterParams.fromBlock = latestBlockNumber;
    }

    if (!isFilter && newFilterParams.toBlock === LATEST_BLOCK) {
      newFilterParams.toBlock = latestBlockNumber;
    }

    if (newFilterParams.toBlock.gt(latestBlockNumber)) {
      newFilterParams.toBlock = latestBlockNumber;
    }
    if (newFilterParams.fromBlock.gt(latestBlockNumber)) {
      newFilterParams.fromBlock = latestBlockNumber;
    }

    return newFilterParams;
  }

  private _newDeadline(): Date {
    const dt = new Date();
    dt.setMinutes(dt.getMinutes() + 5); // This will not overflow
    return dt;
  }

  private _getNextFilterId(): BN {
    this._lastFilterId = this._lastFilterId.addn(1);

    return this._lastFilterId;
  }

  private _filterIdToFiltersKey(filterId: BN): string {
    return filterId.toString();
  }

  private _emitEthEvent(filterId: BN, result: any) {
    this.emit("ethEvent", {
      result,
      filterId,
    });
  }
}
