// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import "../src/ShieldedPool.sol";
import "../src/IVerifier.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock Verifier that always passes for testing
contract AuditMockVerifier is IVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[14] calldata
    ) external pure override returns (bool) {
        return true;
    }
}

// Mock Token
contract AuditMockToken is ERC20 {
    constructor() ERC20("Mock Token", "MCK") {
        _mint(msg.sender, 1000 ether);
    }
}

contract TestAuditLiveScript is Script {
    using stdJson for string;

    function run() external {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // Anvil Account 0
        
        // Read sample ciphertext from Rust DKG gen output
        string memory rootPath = vm.projectRoot();
        string memory jsonPath = string.concat(rootPath, "/test/dkg_test_data.json");
        string memory json = vm.readFile(jsonPath);
        bytes memory sampleCiphertext = json.readBytes(".sample_ciphertext");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy contracts
        AuditMockToken token = new AuditMockToken();
        AuditMockVerifier verifier = new AuditMockVerifier();
        
        // Deploy dummy Poseidon2
        string memory bytecodePath = string.concat(rootPath, "/../Poseidon_bytecode.txt");
        string memory bytecode = vm.readFile(bytecodePath);
        bytes memory poseidonBytecode = vm.parseBytes(bytecode);
        address poseidon2;
        assembly {
            poseidon2 := create(0, add(poseidonBytecode, 0x20), mload(poseidonBytecode))
        }
        require(poseidon2 != address(0), "Poseidon deployment failed");

        ShieldedPool pool = new ShieldedPool(
            address(token),
            address(verifier),
            poseidon2,
            vm.addr(deployerPrivateKey)
        );

        // 2. Fund pool with a deposit
        token.approve(address(pool), 10 ether);
        bytes32 firstCommitment = bytes32(uint256(987654321));
        pool.deposit(firstCommitment, 10 ether);

        // 3. Perform Transact carrying the encrypted audit data (ciphertext)
        bytes memory mockProof = abi.encode(
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
        bytes32 root = pool.getRoot();
        bytes32 nullifier1 = bytes32(uint256(5555));
        bytes32 nullifier2 = bytes32(uint256(6666));
        bytes32 commitment1 = bytes32(uint256(7777));
        bytes32 commitment2 = bytes32(uint256(8888));
        uint256[4] memory mockAuditCiphertext = [uint256(1), uint256(2), uint256(3), uint256(4)];

        pool.transact(
            mockProof,
            root,
            bytes32(0), // cleanTreeRoot
            nullifier1,
            nullifier2,
            commitment1,
            commitment2,
            -5 ether, // withdraw 5 ether
            vm.addr(deployerPrivateKey), // recipient
            address(0), // relayer
            0, // fee
            sampleCiphertext, // Encrypted audit ciphertext from Rust
            mockAuditCiphertext
        );

        vm.stopBroadcast();
        console.log("Transact containing audit data broadcasted successfully.");
    }
}
