import { assert } from "chai";
import { bufferToHex } from "ethereumjs-util";
import sinon from "sinon";

import { numberToRpcQuantity } from "../../../../../internal/hardhat-network/provider/output";
import { ALCHEMY_URL } from "../../../../setup";
import { assertInvalidArgumentsError } from "../../helpers/assertions";
import { EMPTY_ACCOUNT_ADDRESS } from "../../helpers/constants";
import { quantityToNumber } from "../../helpers/conversions";
import { setCWD } from "../../helpers/cwd";
import { DEFAULT_ACCOUNTS_ADDRESSES, PROVIDERS } from "../../helpers/providers";
import { waitForAssert } from "../../helpers/waitForAssert";

describe("Hardhat module", function () {
  PROVIDERS.forEach(({ name, useProvider, isFork }) => {
    describe(`${name} provider`, function () {
      const safeBlockInThePast = 11_200_000; // this should resolve CI errors probably caused by using a block too far in the past

      setCWD();
      useProvider();

      describe("hardhat_impersonateAccount", function () {
        it("validates input parameter", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_impersonateAccount",
            ["0x1234"]
          );

          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_impersonateAccount",
            ["1234567890abcdef1234567890abcdef12345678"]
          );
        });

        it("returns true", async function () {
          const result = await this.provider.send(
            "hardhat_impersonateAccount",
            [bufferToHex(EMPTY_ACCOUNT_ADDRESS)]
          );
          assert.isTrue(result);
        });
      });

      describe("hardhat_stopImpersonatingAccount", function () {
        it("validates input parameter", async function () {
          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_stopImpersonatingAccount",
            ["0x1234"]
          );

          await assertInvalidArgumentsError(
            this.provider,
            "hardhat_stopImpersonatingAccount",
            ["1234567890abcdef1234567890abcdef12345678"]
          );
        });

        it("returns true if the account was impersonated before", async function () {
          await this.provider.send("hardhat_impersonateAccount", [
            bufferToHex(EMPTY_ACCOUNT_ADDRESS),
          ]);
          const result = await this.provider.send(
            "hardhat_stopImpersonatingAccount",
            [bufferToHex(EMPTY_ACCOUNT_ADDRESS)]
          );
          assert.isTrue(result);
        });

        it("returns false if the account wasn't impersonated before", async function () {
          const result = await this.provider.send(
            "hardhat_stopImpersonatingAccount",
            [bufferToHex(EMPTY_ACCOUNT_ADDRESS)]
          );
          assert.isFalse(result);
        });
      });

      describe("hardhat_reset", function () {
        it("validates input parameters", async function () {
          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            { forking: {} },
          ]);

          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            {
              forking: {
                jsonRpcUrl: 123,
              },
            },
          ]);

          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            {
              forking: {
                blockNumber: 0,
              },
            },
          ]);

          await assertInvalidArgumentsError(this.provider, "hardhat_reset", [
            {
              forking: {
                jsonRpcUrl: ALCHEMY_URL,
                blockNumber: "0",
              },
            },
          ]);
        });

        it("returns true", async function () {
          const result = await this.provider.send("hardhat_reset", [
            {
              forking: {
                jsonRpcUrl: ALCHEMY_URL,
                blockNumber: safeBlockInThePast,
              },
            },
          ]);
          assert.isTrue(result);
        });

        it("resets interval mining", async function () {
          const sinonClock = sinon.useFakeTimers({
            now: Date.now(),
            toFake: ["Date", "setTimeout", "clearTimeout"],
          });
          const interval = 15_000;

          await this.provider.send("evm_setAutomineEnabled", [false]);
          await this.provider.send("evm_setIntervalMining", [
            {
              enabled: true,
              blockTime: interval,
            },
          ]);

          const initialBlockNumberBefore = await getLatestBlockNumber();

          await sinonClock.tickAsync(interval);

          await waitForAssert(10, async () => {
            const currentBlockNumber = await getLatestBlockNumber();
            assert.equal(currentBlockNumber, initialBlockNumberBefore + 1);
          });

          await this.provider.send("eth_sendTransaction", [
            {
              from: DEFAULT_ACCOUNTS_ADDRESSES[0],
              to: "0x1111111111111111111111111111111111111111",
              nonce: numberToRpcQuantity(0),
            },
          ]);

          const pendingTxsBefore = await this.provider.send(
            "eth_pendingTransactions"
          );
          assert.lengthOf(pendingTxsBefore, 1);

          const result = await this.provider.send("hardhat_reset");
          assert.isTrue(result);

          const pendingTxsAfter = await this.provider.send(
            "eth_pendingTransactions"
          );
          assert.lengthOf(pendingTxsAfter, 0);

          const initialBlockNumberAfter = await getLatestBlockNumber();

          await sinonClock.tickAsync(30 * interval);

          await waitForAssert(10, async () => {
            const currentBlockNumber = await getLatestBlockNumber();
            assert.equal(currentBlockNumber, initialBlockNumberAfter);
          });

          sinonClock.restore();
        });

        if (isFork) {
          testForkedProviderBehaviour();
        } else {
          testNormalProviderBehaviour();
        }

        const getLatestBlockNumber = async () => {
          return quantityToNumber(
            await this.ctx.provider.send("eth_blockNumber")
          );
        };

        function testForkedProviderBehaviour() {
          it("can reset the forked provider to a given forkBlockNumber", async function () {
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            assert.equal(await getLatestBlockNumber(), 123);
          });

          it("can reset the forked provider to the latest block number", async function () {
            const initialBlock = await getLatestBlockNumber();
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            await this.provider.send("hardhat_reset", [
              { forking: { jsonRpcUrl: ALCHEMY_URL } },
            ]);

            // This condition is rather loose as Infura can sometimes return
            // a smaller block number on subsequent eth_blockNumber call
            assert.closeTo(await getLatestBlockNumber(), initialBlock, 2);
          });

          it("can reset the forked provider to a normal provider", async function () {
            await this.provider.send("hardhat_reset", []);
            assert.equal(await getLatestBlockNumber(), 0);

            await this.provider.send("hardhat_reset", [{}]);
            assert.equal(await getLatestBlockNumber(), 0);
          });
        }

        function testNormalProviderBehaviour() {
          it("can reset the provider to initial state", async function () {
            await this.provider.send("evm_mine");
            assert.equal(await getLatestBlockNumber(), 1);
            await this.provider.send("hardhat_reset", []);
            assert.equal(await getLatestBlockNumber(), 0);
          });

          it("can reset the provider with a fork config", async function () {
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            assert.equal(await getLatestBlockNumber(), 123);
          });

          it("can reset the provider with fork config back to normal config", async function () {
            await this.provider.send("hardhat_reset", [
              {
                forking: {
                  jsonRpcUrl: ALCHEMY_URL,
                  blockNumber: safeBlockInThePast,
                },
              },
            ]);
            await this.provider.send("hardhat_reset", []);
            assert.equal(await getLatestBlockNumber(), 0);
          });
        }
      });
    });
  });
});
