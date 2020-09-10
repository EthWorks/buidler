import { assert } from "chai";
import { BN, bufferToHex, toBuffer } from "ethereumjs-util";
import sinon from "sinon";

import { RpcTransaction } from "../../../../internal/buidler-evm/jsonrpc/types";
import { JsonRpcClient } from "../../../../src/internal/buidler-evm/jsonrpc/client";
import { randomHashBuffer } from "../../../../src/internal/buidler-evm/provider/fork/random";
import { HttpProvider } from "../../../../src/internal/core/providers/http";
import {
  BLOCK_HASH_OF_10496585,
  BLOCK_NUMBER_OF_10496585,
  DAI_ADDRESS,
  DAI_TOTAL_SUPPLY_STORAGE_POSITION,
  EMPTY_ACCOUNT_ADDRESS,
  FIRST_TX_HASH_OF_10496585,
  INFURA_URL,
  WETH_ADDRESS,
} from "../helpers/constants";

describe("JsonRpcClient", () => {
  let client: JsonRpcClient;

  beforeEach(() => {
    client = JsonRpcClient.forUrl(INFURA_URL);
  });

  it("can be constructed", () => {
    assert.instanceOf(client, JsonRpcClient);
  });

  it("can actually fetch real json-rpc", async () => {
    const result = await client.getLatestBlockNumber();
    const minBlockNumber = 10494745; // mainnet block number at 20.07.20
    assert.isAtLeast(result.toNumber(), minBlockNumber);
  });

  describe("caching", () => {
    const response1 =
      "0x00000000000000000000000000000000000000000067bafa8fb7228f04ffa792";
    const response2 =
      "0x00000000000000000000000000000000000000000067bafa8fb7228f04ffa793";

    it("caches fetched data", async () => {
      const fakeProvider = {
        send: sinon.fake.returns(response1),
      };
      const clientWithFakeProvider = new JsonRpcClient(fakeProvider as any);

      function getStorageAt() {
        return clientWithFakeProvider.getStorageAt(
          DAI_ADDRESS,
          DAI_TOTAL_SUPPLY_STORAGE_POSITION,
          "latest"
        );
      }

      await getStorageAt();
      const value = await getStorageAt();

      assert.isTrue(fakeProvider.send.calledOnce);
      assert.isTrue(value.equals(toBuffer(response1)));
    });

    it("is parameter aware", async () => {
      const fakeProvider = {
        send: sinon
          .stub()
          .onFirstCall()
          .returns(response1)
          .onSecondCall()
          .returns(response2),
      };
      const clientWithFakeProvider = new JsonRpcClient(fakeProvider as any);

      await clientWithFakeProvider.getStorageAt(
        DAI_ADDRESS,
        DAI_TOTAL_SUPPLY_STORAGE_POSITION,
        "latest"
      );
      const value = await clientWithFakeProvider.getStorageAt(
        DAI_ADDRESS,
        toBuffer([2]),
        "latest"
      );
      assert.isTrue(fakeProvider.send.calledTwice);
      assert.isTrue(value.equals(toBuffer(response2)));
    });
  });

  describe("eth_blockNumber", () => {
    let response: any;
    const fakeProvider: HttpProvider = {
      send: () => Promise.resolve(response),
    } as any;

    it("returns correct values", async () => {
      const clientWithFakeProvider = new JsonRpcClient(fakeProvider);
      response = "0x1";
      const result = await clientWithFakeProvider.getLatestBlockNumber();
      assert.isTrue(result.eqn(1));
    });

    it("validates the response", async () => {
      const clientWithFakeProvider = new JsonRpcClient(fakeProvider);
      response = "foo";
      await assert.isRejected(
        clientWithFakeProvider.getLatestBlockNumber(),
        Error,
        "Invalid QUANTITY"
      );
    });
  });

  describe("eth_getBalance", () => {
    it("can fetch balance of an existing account", async () => {
      const balance = await client.getBalance(WETH_ADDRESS, "latest");
      assert.isTrue(balance.gtn(0));
    });

    it("can fetch balance of a non-existent account", async () => {
      const balance = await client.getBalance(EMPTY_ACCOUNT_ADDRESS, "latest");
      assert.isTrue(balance.eqn(0));
    });
  });

  describe("eth_getBlockByNumber", () => {
    it("can fetch the data with transaction hashes", async () => {
      const block = await client.getBlockByNumber(BLOCK_NUMBER_OF_10496585);
      assert.isTrue(block?.hash?.equals(BLOCK_HASH_OF_10496585));
      assert.equal(block?.transactions.length, 192);
      assert.isTrue(
        block?.transactions.every(
          (tx: Buffer | RpcTransaction) => tx instanceof Buffer
        )
      );
    });

    it("can fetch the data with transactions", async () => {
      const block = await client.getBlockByNumber(
        BLOCK_NUMBER_OF_10496585,
        true
      );
      assert.isTrue(
        block?.transactions.every(
          (tx: Buffer | RpcTransaction) => !(tx instanceof Buffer)
        )
      );
    });

    it("returns null for non-existent block", async () => {
      const blockNumber = await client.getLatestBlockNumber();
      const block = await client.getBlockByNumber(blockNumber.addn(1000), true);
      assert.isNull(block);
    });
  });

  describe("eth_getBlockByHash", () => {
    it("can fetch the data with transaction hashes", async () => {
      const block = await client.getBlockByHash(BLOCK_HASH_OF_10496585);
      assert.isTrue(block?.hash?.equals(BLOCK_HASH_OF_10496585));
      assert.equal(block?.transactions.length, 192);
      assert.isTrue(
        block?.transactions.every(
          (tx: Buffer | RpcTransaction) => tx instanceof Buffer
        )
      );
    });

    it("can fetch the data with transactions", async () => {
      const block = await client.getBlockByHash(BLOCK_HASH_OF_10496585, true);
      assert.isTrue(
        block?.transactions.every(
          (tx: Buffer | RpcTransaction) => !(tx instanceof Buffer)
        )
      );
    });

    it("returns null for non-existent block", async () => {
      const block = await client.getBlockByHash(randomHashBuffer(), true);
      assert.isNull(block);
    });
  });

  describe("eth_getCode", () => {
    it("can fetch code of an existing contract", async () => {
      const code = await client.getCode(DAI_ADDRESS, "latest");
      assert.notEqual(bufferToHex(code), "0x");
    });

    it("can fetch empty code of a non-existent contract", async () => {
      const code = await client.getCode(EMPTY_ACCOUNT_ADDRESS, "latest");
      assert.equal(bufferToHex(code), "0x");
    });
  });

  describe("eth_getStorageAt", () => {
    it("can fetch value from storage of an existing contract", async () => {
      const totalSupply = await client.getStorageAt(
        DAI_ADDRESS,
        DAI_TOTAL_SUPPLY_STORAGE_POSITION,
        "latest"
      );
      const totalSupplyBN = new BN(totalSupply);
      assert.isTrue(totalSupplyBN.gtn(0));
    });

    it("can fetch empty value from storage of an existing contract", async () => {
      const value = await client.getStorageAt(
        DAI_ADDRESS,
        toBuffer("0xbaddcafe"),
        "latest"
      );
      const valueBN = new BN(value);
      assert.isTrue(valueBN.eqn(0));
    });

    it("can fetch empty value from storage of a non-existent contract", async () => {
      const value = await client.getStorageAt(
        EMPTY_ACCOUNT_ADDRESS,
        toBuffer([1]),
        "latest"
      );
      const valueBN = new BN(value);
      assert.isTrue(valueBN.eqn(0));
    });
  });

  describe("eth_getTransactionCount", () => {
    it("can fetch nonce of an existing account", async () => {
      const nonce = await client.getTransactionCount(WETH_ADDRESS, "latest");
      assert.isTrue(nonce.eqn(1));
    });

    it("can fetch nonce of a non-existent account", async () => {
      const nonce = await client.getTransactionCount(
        EMPTY_ACCOUNT_ADDRESS,
        "latest"
      );
      assert.isTrue(nonce.eqn(0));
    });
  });

  describe("getTransactionByHash", () => {
    it("can fetch existing transactions", async () => {
      const transaction = await client.getTransactionByHash(
        FIRST_TX_HASH_OF_10496585
      );
      assert.isTrue(transaction?.hash.equals(FIRST_TX_HASH_OF_10496585));
      assert.isTrue(transaction?.blockHash?.equals(BLOCK_HASH_OF_10496585));
    });

    it("returns null for non-existent transactions", async () => {
      const transaction = await client.getTransactionByHash(randomHashBuffer());
      assert.equal(transaction, null);
    });
  });
});
