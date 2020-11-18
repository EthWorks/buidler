export const EXAMPLE_READ_CONTRACT = {
  sourceCode: `pragma solidity 0.5.10;

contract Example {
    event ReturnValue(uint value);
    
    function blockNumber() public view returns (uint) {
        return block.number;
    }
    function blockTimestamp() public view returns (uint) {
        return now;
    }
    function blockGasLimit() public returns (uint) {
        emit ReturnValue(block.gaslimit);
        return block.gaslimit;
    }
    function gasLeft() public returns (uint) {
        uint gas = gasleft();
        emit ReturnValue(gas);
        return gas;
    }
}`,
  bytecode: {
    linkReferences: {},
    object:
      "608060405234801561001057600080fd5b5061012e806100206000396000f3fe6080604052348015600f57600080fd5b506004361060465760003560e01c80632ddb301b14604b57806357e871e71460635780637877a797146069578063adb6183214606f575b600080fd5b60516075565b60408051918252519081900360200190f35b605160b5565b605160b9565b605160f5565b6000805a6040805182815290519192507f3a1575e395fa8386a814e103dd43d4a6a43479ce4e36cb661466fa47fe2e7996919081900360200190a1905090565b4390565b6040805145815290516000917f3a1575e395fa8386a814e103dd43d4a6a43479ce4e36cb661466fa47fe2e7996919081900360200190a1504590565b429056fea265627a7a72305820b8bbc13fd66108e69c4e0ea907fb86c9dbce31225a6c1cd4e9b830e5d66272da64736f6c634300050a0032",
    opcodes:
      "PUSH1 0x80 PUSH1 0x40 MSTORE CALLVALUE DUP1 ISZERO PUSH2 0x10 JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH2 0x12E DUP1 PUSH2 0x20 PUSH1 0x0 CODECOPY PUSH1 0x0 RETURN INVALID PUSH1 0x80 PUSH1 0x40 MSTORE CALLVALUE DUP1 ISZERO PUSH1 0xF JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH1 0x4 CALLDATASIZE LT PUSH1 0x46 JUMPI PUSH1 0x0 CALLDATALOAD PUSH1 0xE0 SHR DUP1 PUSH4 0x2DDB301B EQ PUSH1 0x4B JUMPI DUP1 PUSH4 0x57E871E7 EQ PUSH1 0x63 JUMPI DUP1 PUSH4 0x7877A797 EQ PUSH1 0x69 JUMPI DUP1 PUSH4 0xADB61832 EQ PUSH1 0x6F JUMPI JUMPDEST PUSH1 0x0 DUP1 REVERT JUMPDEST PUSH1 0x51 PUSH1 0x75 JUMP JUMPDEST PUSH1 0x40 DUP1 MLOAD SWAP2 DUP3 MSTORE MLOAD SWAP1 DUP2 SWAP1 SUB PUSH1 0x20 ADD SWAP1 RETURN JUMPDEST PUSH1 0x51 PUSH1 0xB5 JUMP JUMPDEST PUSH1 0x51 PUSH1 0xB9 JUMP JUMPDEST PUSH1 0x51 PUSH1 0xF5 JUMP JUMPDEST PUSH1 0x0 DUP1 GAS PUSH1 0x40 DUP1 MLOAD DUP3 DUP2 MSTORE SWAP1 MLOAD SWAP2 SWAP3 POP PUSH32 0x3A1575E395FA8386A814E103DD43D4A6A43479CE4E36CB661466FA47FE2E7996 SWAP2 SWAP1 DUP2 SWAP1 SUB PUSH1 0x20 ADD SWAP1 LOG1 SWAP1 POP SWAP1 JUMP JUMPDEST NUMBER SWAP1 JUMP JUMPDEST PUSH1 0x40 DUP1 MLOAD GASLIMIT DUP2 MSTORE SWAP1 MLOAD PUSH1 0x0 SWAP2 PUSH32 0x3A1575E395FA8386A814E103DD43D4A6A43479CE4E36CB661466FA47FE2E7996 SWAP2 SWAP1 DUP2 SWAP1 SUB PUSH1 0x20 ADD SWAP1 LOG1 POP GASLIMIT SWAP1 JUMP JUMPDEST TIMESTAMP SWAP1 JUMP INVALID LOG2 PUSH6 0x627A7A723058 KECCAK256 0xb8 0xbb 0xc1 EXTCODEHASH 0xd6 PUSH2 0x8E6 SWAP13 0x4e 0xe 0xa9 SMOD 0xfb DUP7 0xc9 0xdb 0xce BALANCE 0x22 GAS PUSH13 0x1CD4E9B830E5D66272DA64736F PUSH13 0x634300050A0032000000000000 ",
    sourceMap: "25:502:0:-;;;;8:9:-1;5:2;;;30:1;27;20:12;5:2;25:502:0;;;;;;;",
  },
  abi: [
    {
      constant: false,
      inputs: [],
      name: "blockGasLimit",
      outputs: [
        {
          name: "",
          type: "uint256",
        },
      ],
      payable: false,
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      constant: false,
      inputs: [],
      name: "gasLeft",
      outputs: [
        {
          name: "",
          type: "uint256",
        },
      ],
      payable: false,
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          name: "value",
          type: "uint256",
        },
      ],
      name: "ReturnValue",
      type: "event",
    },
    {
      constant: true,
      inputs: [],
      name: "blockNumber",
      outputs: [
        {
          name: "",
          type: "uint256",
        },
      ],
      payable: false,
      stateMutability: "view",
      type: "function",
    },
    {
      constant: true,
      inputs: [],
      name: "blockTimestamp",
      outputs: [
        {
          name: "",
          type: "uint256",
        },
      ],
      payable: false,
      stateMutability: "view",
      type: "function",
    },
  ],
  selectors: {
    blockNumber: "0x57e871e7",
    blockTimestamp: "0xadb61832",
    blockGasLimit: "0x7877a797",
    gasLeft: "0x2ddb301b",
  },
  topics: {},
};

export const EXAMPLE_CONTRACT = {
  sourceCode: `pragma solidity 0.5.10;

contract Example {
    event StateModified(uint256 indexed _oldI, uint256 _newI);
    
    
    uint256 public i = 0;
    uint8 public j = 1;
    bytes32 h = "1234567890123456789012345678901234567890123456789012345678901234";
    
    function modifiesState(uint256 _i) payable public {
        emit StateModified(i, _i);
        i = _i;
    }
    
}`,
  // Compiled with Remix.
  bytecode: {
    linkReferences: {},
    object:
      "60806040526000805560018060006101000a81548160ff021916908360ff1602179055507f123456789012345678901234567890123456789012345678901234567890123460001b60025534801561005657600080fd5b50610155806100666000396000f3fe6080604052600436106100345760003560e01c80631b334ecc14610039578063b582ec5f14610067578063e5aa3d5814610098575b600080fd5b6100656004803603602081101561004f57600080fd5b81019080803590602001909291905050506100c3565b005b34801561007357600080fd5b5061007c610107565b604051808260ff1660ff16815260200191505060405180910390f35b3480156100a457600080fd5b506100ad61011a565b6040518082815260200191505060405180910390f35b6000547f3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d826040518082815260200191505060405180910390a28060008190555050565b600160009054906101000a900460ff1681565b6000548156fea265627a7a72305820951d38e524dcd5a927d384cf274e65b6e0ac9bae6a41e5e1a7f1275697b8f0b764736f6c634300050a0032",
    opcodes:
      "PUSH1 0x80 PUSH1 0x40 MSTORE PUSH1 0x0 DUP1 SSTORE PUSH1 0x1 DUP1 PUSH1 0x0 PUSH2 0x100 EXP DUP2 SLOAD DUP2 PUSH1 0xFF MUL NOT AND SWAP1 DUP4 PUSH1 0xFF AND MUL OR SWAP1 SSTORE POP PUSH32 0x1234567890123456789012345678901234567890123456789012345678901234 PUSH1 0x0 SHL PUSH1 0x2 SSTORE CALLVALUE DUP1 ISZERO PUSH2 0x56 JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH2 0x155 DUP1 PUSH2 0x66 PUSH1 0x0 CODECOPY PUSH1 0x0 RETURN INVALID PUSH1 0x80 PUSH1 0x40 MSTORE PUSH1 0x4 CALLDATASIZE LT PUSH2 0x34 JUMPI PUSH1 0x0 CALLDATALOAD PUSH1 0xE0 SHR DUP1 PUSH4 0x1B334ECC EQ PUSH2 0x39 JUMPI DUP1 PUSH4 0xB582EC5F EQ PUSH2 0x67 JUMPI DUP1 PUSH4 0xE5AA3D58 EQ PUSH2 0x98 JUMPI JUMPDEST PUSH1 0x0 DUP1 REVERT JUMPDEST PUSH2 0x65 PUSH1 0x4 DUP1 CALLDATASIZE SUB PUSH1 0x20 DUP2 LT ISZERO PUSH2 0x4F JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST DUP2 ADD SWAP1 DUP1 DUP1 CALLDATALOAD SWAP1 PUSH1 0x20 ADD SWAP1 SWAP3 SWAP2 SWAP1 POP POP POP PUSH2 0xC3 JUMP JUMPDEST STOP JUMPDEST CALLVALUE DUP1 ISZERO PUSH2 0x73 JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH2 0x7C PUSH2 0x107 JUMP JUMPDEST PUSH1 0x40 MLOAD DUP1 DUP3 PUSH1 0xFF AND PUSH1 0xFF AND DUP2 MSTORE PUSH1 0x20 ADD SWAP2 POP POP PUSH1 0x40 MLOAD DUP1 SWAP2 SUB SWAP1 RETURN JUMPDEST CALLVALUE DUP1 ISZERO PUSH2 0xA4 JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH2 0xAD PUSH2 0x11A JUMP JUMPDEST PUSH1 0x40 MLOAD DUP1 DUP3 DUP2 MSTORE PUSH1 0x20 ADD SWAP2 POP POP PUSH1 0x40 MLOAD DUP1 SWAP2 SUB SWAP1 RETURN JUMPDEST PUSH1 0x0 SLOAD PUSH32 0x3359F789EA83A10B6E9605D460DE1088FF290DD7B3C9A155C896D45CF495ED4D DUP3 PUSH1 0x40 MLOAD DUP1 DUP3 DUP2 MSTORE PUSH1 0x20 ADD SWAP2 POP POP PUSH1 0x40 MLOAD DUP1 SWAP2 SUB SWAP1 LOG2 DUP1 PUSH1 0x0 DUP2 SWAP1 SSTORE POP POP JUMP JUMPDEST PUSH1 0x1 PUSH1 0x0 SWAP1 SLOAD SWAP1 PUSH2 0x100 EXP SWAP1 DIV PUSH1 0xFF AND DUP2 JUMP JUMPDEST PUSH1 0x0 SLOAD DUP2 JUMP INVALID LOG2 PUSH6 0x627A7A723058 KECCAK256 SWAP6 SAR CODESIZE 0xe5 0x24 0xdc 0xd5 0xa9 0x27 0xd3 DUP5 0xcf 0x27 0x4e PUSH6 0xB6E0AC9BAE6A COINBASE 0xe5 0xe1 0xa7 CALL 0x27 JUMP SWAP8 0xb8 CREATE 0xb7 PUSH5 0x736F6C6343 STOP SDIV EXP STOP ORIGIN ",
    sourceMap:
      "25:350:0:-;;;140:1;121:20;;164:1;147:18;;;;;;;;;;;;;;;;;;;;183:66;171:78;;;;25:350;8:9:-1;5:2;;;30:1;27;20:12;5:2;25:350:0;;;;;;;",
  },
  abi: [
    {
      constant: false,
      inputs: [
        {
          name: "_i",
          type: "uint256",
        },
      ],
      name: "modifiesState",
      outputs: [],
      payable: true,
      stateMutability: "payable",
      type: "function",
    },
    {
      constant: true,
      inputs: [],
      name: "j",
      outputs: [
        {
          name: "",
          type: "uint8",
        },
      ],
      payable: false,
      stateMutability: "view",
      type: "function",
    },
    {
      constant: true,
      inputs: [],
      name: "i",
      outputs: [
        {
          name: "",
          type: "uint256",
        },
      ],
      payable: false,
      stateMutability: "view",
      type: "function",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: "_oldI",
          type: "uint256",
        },
        {
          indexed: false,
          name: "_newI",
          type: "uint256",
        },
      ],
      name: "StateModified",
      type: "event",
    },
  ],
  // Computed with https://abitopic.now.sh/
  selectors: {
    i: "0xe5aa3d58",
    j: "0xb582ec5f",
    modifiesState: "0x1b334ecc",
  },
  topics: {
    StateModified: [
      "0x3359f789ea83a10b6e9605d460de1088ff290dd7b3c9a155c896d45cf495ed4d",
    ],
  },
};

export const EXAMPLE_BLOCKHASH_CONTRACT = {
  sourceCode: `
pragma solidity 0.7.3;

contract Example {
    function test() public view returns(bool) {
        blockhash(0);
        blockhash(1);
        blockhash(1000000);

        return true;
    }
}
`,
  bytecode: {
    linkReferences: {},
    object:
      "608060405234801561001057600080fd5b5060ea8061001f6000396000f3fe6080604052348015600f57600080fd5b5060043610603c5760003560e01c80636b59084d14604157806377ff24f414605d578063e89c852c146079575b600080fd5b60476095565b6040518082815260200191505060405180910390f35b6063609f565b6040518082815260200191505060405180910390f35b607f60a8565b6040518082815260200191505060405180910390f35b6000600140905090565b60008040905090565b6000620f42404090509056fea2646970667358221220e1c801d1bc0f80c83f6f16dbf28981d90da4b0f2a32ca4cc0fb910a8e6b6df7a64736f6c63430007030033",
    opcodes:
      "PUSH1 0x80 PUSH1 0x40 MSTORE CALLVALUE DUP1 ISZERO PUSH2 0x10 JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH1 0xEA DUP1 PUSH2 0x1F PUSH1 0x0 CODECOPY PUSH1 0x0 RETURN INVALID PUSH1 0x80 PUSH1 0x40 MSTORE CALLVALUE DUP1 ISZERO PUSH1 0xF JUMPI PUSH1 0x0 DUP1 REVERT JUMPDEST POP PUSH1 0x4 CALLDATASIZE LT PUSH1 0x3C JUMPI PUSH1 0x0 CALLDATALOAD PUSH1 0xE0 SHR DUP1 PUSH4 0x6B59084D EQ PUSH1 0x41 JUMPI DUP1 PUSH4 0x77FF24F4 EQ PUSH1 0x5D JUMPI DUP1 PUSH4 0xE89C852C EQ PUSH1 0x79 JUMPI JUMPDEST PUSH1 0x0 DUP1 REVERT JUMPDEST PUSH1 0x47 PUSH1 0x95 JUMP JUMPDEST PUSH1 0x40 MLOAD DUP1 DUP3 DUP2 MSTORE PUSH1 0x20 ADD SWAP2 POP POP PUSH1 0x40 MLOAD DUP1 SWAP2 SUB SWAP1 RETURN JUMPDEST PUSH1 0x63 PUSH1 0x9F JUMP JUMPDEST PUSH1 0x40 MLOAD DUP1 DUP3 DUP2 MSTORE PUSH1 0x20 ADD SWAP2 POP POP PUSH1 0x40 MLOAD DUP1 SWAP2 SUB SWAP1 RETURN JUMPDEST PUSH1 0x7F PUSH1 0xA8 JUMP JUMPDEST PUSH1 0x40 MLOAD DUP1 DUP3 DUP2 MSTORE PUSH1 0x20 ADD SWAP2 POP POP PUSH1 0x40 MLOAD DUP1 SWAP2 SUB SWAP1 RETURN JUMPDEST PUSH1 0x0 PUSH1 0x1 BLOCKHASH SWAP1 POP SWAP1 JUMP JUMPDEST PUSH1 0x0 DUP1 BLOCKHASH SWAP1 POP SWAP1 JUMP JUMPDEST PUSH1 0x0 PUSH3 0xF4240 BLOCKHASH SWAP1 POP SWAP1 JUMP INVALID LOG2 PUSH5 0x6970667358 0x22 SLT KECCAK256 0xE1 0xC8 ADD 0xD1 0xBC 0xF DUP1 0xC8 EXTCODEHASH PUSH16 0x16DBF28981D90DA4B0F2A32CA4CC0FB9 LT 0xA8 0xE6 0xB6 0xDF PUSH27 0x64736F6C6343000703003300000000000000000000000000000000 ",
    sourceMap: "24:290:0:-:0;;;;;;;;;;;;;;;;;;;",
  },
  abi: [
    {
      inputs: [],
      name: "test0",
      outputs: [
        {
          internalType: "bytes32",
          name: "",
          type: "bytes32",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [],
      name: "test1",
      outputs: [
        {
          internalType: "bytes32",
          name: "",
          type: "bytes32",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [],
      name: "test1m",
      outputs: [
        {
          internalType: "bytes32",
          name: "",
          type: "bytes32",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
  ],
  selectors: {
    test0: "0x77ff24f4",
    test1: "0x6b59084d",
    test1m: "0xe89c852c",
  },
  topics: {},
};
