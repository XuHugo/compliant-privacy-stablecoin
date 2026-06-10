// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";
import "../src/ShieldedPool.sol";
import "../src/AuditRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestLiveContractsScript is Script {
    using stdJson for string;

    // 填入先前部署成功的真实链上地址 (最新更新)
    address constant TOKEN_ADDRESS = 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707;
    address constant POOL_ADDRESS = 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6;
    address constant REGISTRY_ADDRESS = 0x8A791620dd6260079BF849Dc5567aDC3F2FdC318;

    function run() external {
        // 读取由 Rust 客户端生成的真实 DKG 数据
        string memory rootPath = vm.projectRoot();
        string memory path = string.concat(rootPath, "/test/dkg_test_data.json");
        string memory json = vm.readFile(path);

        // 提取 5 个审计人地址与私钥（Anvil 默认的 Key 1 到 Key 5）
        address[5] memory realAuditors;
        uint256[5] memory auditorPrivateKeys = [
            0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d, // Key 1
            0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a, // Key 2 (Corrected Key 2 PK)
            0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6, // Key 3 (Corrected Key 3 PK)
            0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a, // Key 4 (Corrected Key 4 PK)
            0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba  // Key 5 (Corrected Key 5 PK)
        ];

        for (uint i = 0; i < 5; i++) {
            realAuditors[i] = json.readAddress(string.concat(".nodes[", vm.toString(i), "].address"));
        }

        // 绑定部署好的真实合约实例
        ShieldedPool pool = ShieldedPool(POOL_ADDRESS);
        AuditRegistry registry = AuditRegistry(REGISTRY_ADDRESS);
        IERC20 token = IERC20(TOKEN_ADDRESS);

        console.log(unicode"=== 开始测试已部署的真实合约 ===");

        // ==========================================
        // 测试 1. 真实存款交互（使用 Anvil 默认账户 0）
        // ==========================================
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

        vm.startBroadcast(deployerPrivateKey);
        
        // 授权代币并存款
        token.approve(POOL_ADDRESS, 10 ether);
        bytes32 commitment = bytes32(uint256(123456789));
        pool.deposit(commitment, 10 ether);
        
        vm.stopBroadcast();

        // 验证链上余额和树叶状态是否真正发生改变
        require(token.balanceOf(POOL_ADDRESS) >= 10 ether, "L1 pool balance mismatch");
        require(pool.leaves(0) == commitment, "L1 leaf commitment mismatch");
        console.log(unicode"-> 1. 真实存款测试通过！代币已锁入池子，Commitment 成功上链。");

        // ==========================================
        // 测试 2. 真实 DKG 数据上链存证与广播
        // ==========================================
        for (uint i = 0; i < 5; i++) {
            uint256 auditorKey = auditorPrivateKeys[i];
            address auditor = realAuditors[i];

            // 读取真实数据
            bytes memory commKey = json.readBytes(string.concat(".nodes[", vm.toString(i), "].communication_key"));
            bytes[3] memory commitments;
            commitments[0] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].commitments[0]"));
            commitments[1] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].commitments[1]"));
            commitments[2] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].commitments[2]"));

            bytes[5] memory shares;
            for (uint j = 0; j < 5; j++) {
                shares[j] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].shares[", vm.toString(j), "]"));
            }

            // 签名并广播审计节点交易
            vm.startBroadcast(auditorKey);
            registry.registerCommunicationKey(commKey);
            registry.submitDkgData(commitments, realAuditors, shares);
            vm.stopBroadcast();

            // 验证 Anvil 节点状态是否被修改
            require(registry.communicationPublicKeys(auditor).length > 0, "L1 comm key missing");
            require(registry.dkgCommitments(auditor, 0).length > 0, "L1 commitments missing");
        }
        console.log(unicode"-> 2. 真实 DKG 节点存证数据成功广播上链并持久化！");

        // ==========================================
        // 测试 3. 真实全局审计公钥公示与完成标记
        // ==========================================
        bytes memory globalPubKey = json.readBytes(".global_public_key");

        // 使用 Auditor 1 的私钥签名广播，Finalize 公钥
        vm.startBroadcast(auditorPrivateKeys[0]);
        registry.finalizeGlobalPublicKey(globalPubKey);
        vm.stopBroadcast();

        // 验证链上公示状态
        require(registry.isDkgCompleted(), "DKG finalization state mismatch");
        require(keccak256(registry.globalAuditPublicKey()) == keccak256(globalPubKey), "Global public key mismatch");
        console.log(unicode"-> 3. 真实全局审计公钥已成功公示并完成 DKG！");
        console.log(unicode"=== 所有已部署合约的端到端真实交互测试全部通过！ ===");
    }
}
