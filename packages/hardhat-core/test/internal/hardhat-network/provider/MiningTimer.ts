import { assert } from "chai";
import { ceil } from "lodash";
import sinon from "sinon";

import { MiningTimer } from "../../../../src/internal/hardhat-network/provider/MiningTimer";
import { DEFAULT_INTERVAL_MINING_CONFIG } from "../helpers/providers";

describe("Mining Timer", () => {
  const defaultBlockTime = DEFAULT_INTERVAL_MINING_CONFIG.blockTime;
  let miningTimer: MiningTimer;
  let mineFunction: sinon.SinonSpy;
  let sinonClock: sinon.SinonFakeTimers;

  beforeEach(() => {
    mineFunction = sinon.fake();

    miningTimer = new MiningTimer(defaultBlockTime, mineFunction);

    sinonClock = sinon.useFakeTimers({
      now: Date.now(),
      toFake: ["setTimeout", "clearTimeout"],
    });
  });

  afterEach(() => {
    sinonClock.restore();
  });

  it("throws when blockTime passed to the constructor is 0 ms or less", () => {
    assert.throws(
      () => new MiningTimer(0, mineFunction),
      Error,
      "Block time passed to the constructor must be greater than 0 ms"
    );

    assert.throws(
      () => new MiningTimer(-1, mineFunction),
      Error,
      "Block time passed to the constructor must be greater than 0 ms"
    );
  });

  describe("setBlockTime", () => {
    it("sets a new block time", () => {
      const newBlockTime = 15000;

      miningTimer.setBlockTime(newBlockTime);

      const actualBlockTime = miningTimer.getBlockTime();

      assert.equal(actualBlockTime, newBlockTime);
    });

    it("triggers a new loop when mining timer is running", async () => {
      const newBlockTime = ceil(defaultBlockTime / 2);

      miningTimer.start();

      await sinonClock.tickAsync(defaultBlockTime - 500);

      miningTimer.setBlockTime(newBlockTime);

      await sinonClock.tickAsync(500);

      const currentBlockTime = miningTimer.getBlockTime();

      assert.equal(currentBlockTime, newBlockTime);
      assert.isTrue(mineFunction.notCalled);

      await sinonClock.tickAsync(newBlockTime - 500);
      assert.isTrue(mineFunction.calledOnce);
    });

    it("throws when the new block time is 0 ms or less", () => {
      assert.throws(
        () => miningTimer.setBlockTime(0),
        Error,
        "New block time must be greater than 0 ms"
      );

      assert.throws(
        () => miningTimer.setBlockTime(-1),
        Error,
        "New block time must be greater than 0 ms"
      );
    });
  });

  describe("start", () => {
    it("starts the loop", async () => {
      miningTimer.start();

      assert.isTrue(mineFunction.notCalled);

      await sinonClock.tickAsync(defaultBlockTime);
      assert.isTrue(mineFunction.calledOnce);
    });

    it("the loop executes the callback over time", async () => {
      miningTimer.start();

      assert.isTrue(mineFunction.notCalled);

      await sinonClock.tickAsync(defaultBlockTime);
      assert.isTrue(mineFunction.calledOnce);

      await sinonClock.tickAsync(defaultBlockTime);
      assert.isTrue(mineFunction.calledTwice);

      await sinonClock.tickAsync(defaultBlockTime);
      assert.isTrue(mineFunction.calledThrice);
    });

    it("multiple start calls don't affect the loop", async () => {
      miningTimer.start();

      await sinonClock.tickAsync(defaultBlockTime - 500);

      miningTimer.start();

      assert.isTrue(mineFunction.notCalled);

      await sinonClock.tickAsync(500);

      assert.isTrue(mineFunction.calledOnce);
    });
  });

  describe("stop", () => {
    it("stops the loop", async () => {
      miningTimer.start();

      assert.isTrue(mineFunction.notCalled);

      miningTimer.stop();

      await sinonClock.tickAsync(defaultBlockTime);
      assert.isTrue(mineFunction.notCalled);
    });

    it("stops the loop after a couple of callback executions", async () => {
      miningTimer.start();

      await sinonClock.tickAsync(2 * defaultBlockTime);

      assert.isTrue(mineFunction.calledTwice);

      mineFunction.resetHistory();
      miningTimer.stop();

      await sinonClock.tickAsync(defaultBlockTime);
      assert.isTrue(mineFunction.notCalled);
    });
  });
});
