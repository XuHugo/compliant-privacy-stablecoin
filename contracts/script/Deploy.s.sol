// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ShieldedPool.sol";
import "../src/AuditRegistry.sol";
import "../src/Verifier.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock Token for deployment
contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MCK") {
        _mint(msg.sender, 1000000 * 10**18);
    }
}

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)); // Default Anvil Private Key 0
        address deployerAddress = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Mock Token
        MockToken token = new MockToken();
        console.log("MockToken deployed at:", address(token));

        // 2. Deploy Poseidon Contract from Bytecode
        string memory rootPath = vm.projectRoot();
        string memory path = string.concat(rootPath, "/../Poseidon_bytecode.txt");
        string memory bytecode = vm.readFile(path);
        bytes memory data = vm.parseBytes(bytecode);
        
        address poseidonAddress;
        assembly {
            poseidonAddress := create(0, add(data, 0x20), mload(data))
        }
        require(poseidonAddress != address(0), "Poseidon deployment failed");
        console.log("Poseidon deployed at:", poseidonAddress);

        // 3. Deploy ZK Verifier
        Groth16Verifier verifier = new Groth16Verifier();
        console.log("Groth16Verifier deployed at:", address(verifier));

        // 4. Deploy ShieldedPool
        ShieldedPool pool = new ShieldedPool(
            address(token),
            address(verifier),
            poseidonAddress,
            deployerAddress // set deployer as compliance signer for testing
        );
        console.log("ShieldedPool deployed at:", address(pool));

        // 5. Deploy AuditRegistry with 5 mock auditors
        address[5] memory auditors = [
            address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8), // Anvil Key 1
            address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC), // Anvil Key 2
            address(0x90F79bf6EB2c4f870365E785982E1f101E93b906), // Anvil Key 3
            address(0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65), // Anvil Key 4
            address(0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc)  // Anvil Key 5 (Correct Anvil Address)
        ];
        AuditRegistry registry = new AuditRegistry(auditors);
        console.log("AuditRegistry deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
