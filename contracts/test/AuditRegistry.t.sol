// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdJson.sol";
import "../src/AuditRegistry.sol";

contract AuditRegistryTest is Test {
    using stdJson for string;

    AuditRegistry public registry;

    address[5] public mockAuditors = [
        address(0x11),
        address(0x22),
        address(0x33),
        address(0x44),
        address(0x55)
    ];

    address public nonAuditor = address(0x99);
    address public owner;

    function setUp() public {
        owner = address(this);
        registry = new AuditRegistry(mockAuditors);
    }

    // 测试构造函数正确初始化审计节点名册
    function testConstructorInitialization() public view {
        for (uint i = 0; i < 5; i++) {
            assertEq(registry.auditors(i), mockAuditors[i]);
            assertTrue(registry.isAuditor(mockAuditors[i]));
        }
        assertFalse(registry.isAuditor(nonAuditor));
    }

    // 测试注册通信公钥功能
    function testRegisterCommunicationKey() public {
        bytes memory commKey = hex"abcdef1234567890";

        // 非审计节点注册应当失败
        vm.prank(nonAuditor);
        vm.expectRevert("Not an authorized auditor");
        registry.registerCommunicationKey(commKey);

        // 审计节点正常注册
        vm.prank(mockAuditors[0]);
        registry.registerCommunicationKey(commKey);

        bytes memory storedKey = registry.communicationPublicKeys(mockAuditors[0]);
        assertEq(storedKey, commKey);
    }

    // 测试提交 DKG 数据功能
    function testSubmitDkgData() public {
        bytes[3] memory commitments;
        commitments[0] = hex"1111";
        commitments[1] = hex"2222";
        commitments[2] = hex"3333";

        address[5] memory recipients = [
            mockAuditors[0],
            mockAuditors[1],
            mockAuditors[2],
            mockAuditors[3],
            mockAuditors[4]
        ];

        bytes[5] memory shares;
        shares[0] = hex"aaa0";
        shares[1] = hex"aaa1";
        shares[2] = hex"aaa2";
        shares[3] = hex"aaa3";
        shares[4] = hex"aaa4";

        // 非审计节点调用应当失败
        vm.prank(nonAuditor);
        vm.expectRevert("Not an authorized auditor");
        registry.submitDkgData(commitments, recipients, shares);

        // 审计节点成功调用
        vm.prank(mockAuditors[0]);
        registry.submitDkgData(commitments, recipients, shares);

        // 校验 DKG 承诺点是否被正确保存
        assertEq(registry.dkgCommitments(mockAuditors[0], 0), hex"1111");
        assertEq(registry.dkgCommitments(mockAuditors[0], 1), hex"2222");
        assertEq(registry.dkgCommitments(mockAuditors[0], 2), hex"3333");

        // 校验加密后的多项式碎片是否分发正确
        assertEq(registry.encryptedShares(mockAuditors[0], mockAuditors[1]), hex"aaa1");
        assertEq(registry.encryptedShares(mockAuditors[0], mockAuditors[4]), hex"aaa4");
    }

    // 测试向非审计节点分发碎片应当失败
    function testSubmitDkgDataToNonAuditorFails() public {
        bytes[3] memory commitments;
        commitments[0] = hex"11";
        commitments[1] = hex"22";
        commitments[2] = hex"33";

        address[5] memory recipients = [nonAuditor, address(0), address(0), address(0), address(0)];

        bytes[5] memory shares;
        shares[0] = hex"aabb";
        // rest are empty

        vm.prank(mockAuditors[0]);
        vm.expectRevert("Recipient must be an authorized auditor");
        registry.submitDkgData(commitments, recipients, shares);
    }

    // 测试确定并公示全局公钥功能
    function testFinalizeGlobalPublicKey() public {
        bytes memory globalPubKey = hex"deadbeef1122334455";

        // 非 Authorized 角色调用应当失败
        vm.prank(nonAuditor);
        vm.expectRevert("Unauthorized to finalize public key");
        registry.finalizeGlobalPublicKey(globalPubKey);

        // Owner 可以成功调用
        registry.finalizeGlobalPublicKey(globalPubKey);
        assertTrue(registry.isDkgCompleted());
        assertEq(registry.globalAuditPublicKey(), globalPubKey);

        // 重设一个值，由其中一个 Auditor 调用也应该成功
        bytes memory anotherGlobalPubKey = hex"cafebebe998877";
        vm.prank(mockAuditors[2]);
        registry.finalizeGlobalPublicKey(anotherGlobalPubKey);
        assertEq(registry.globalAuditPublicKey(), anotherGlobalPubKey);
    }

    // 核心密码学测试：与 Rust 客户端生成的真实 DKG 数据联合验证
    function testRealDkgWorkflow() public {
        // 1. 读取由 Rust 客户端生成的真实 DKG 测试数据 JSON
        string memory rootPath = vm.projectRoot();
        string memory path = string.concat(rootPath, "/test/dkg_test_data.json");
        string memory json = vm.readFile(path);

        // 2. 从 JSON 中提取真实的 5 个审计人地址
        address[5] memory realAuditors;
        realAuditors[0] = json.readAddress(".nodes[0].address");
        realAuditors[1] = json.readAddress(".nodes[1].address");
        realAuditors[2] = json.readAddress(".nodes[2].address");
        realAuditors[3] = json.readAddress(".nodes[3].address");
        realAuditors[4] = json.readAddress(".nodes[4].address");

        // 3. 部署一个使用真实审计人名册的 AuditRegistry
        AuditRegistry realRegistry = new AuditRegistry(realAuditors);

        // 4. 模拟 5 个节点分别上传自己的通信公钥、多项式承诺和加密碎片
        for (uint i = 0; i < 5; i++) {
            address auditor = realAuditors[i];
            
            // 注册通信公钥
            bytes memory commKey = json.readBytes(string.concat(".nodes[", vm.toString(i), "].communication_key"));
            vm.prank(auditor);
            realRegistry.registerCommunicationKey(commKey);

            // 读取真实多项式承诺 (A_i0, A_i1, A_i2)
            bytes[3] memory commitments;
            commitments[0] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].commitments[0]"));
            commitments[1] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].commitments[1]"));
            commitments[2] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].commitments[2]"));

            // 读取发给 5 个接收方的加密多项式碎片
            bytes[5] memory shares;
            shares[0] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].shares[0]"));
            shares[1] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].shares[1]"));
            shares[2] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].shares[2]"));
            shares[3] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].shares[3]"));
            shares[4] = json.readBytes(string.concat(".nodes[", vm.toString(i), "].shares[4]"));

            // 广播 DKG 存证数据
            vm.prank(auditor);
            realRegistry.submitDkgData(commitments, realAuditors, shares);

            // 验证链上存储的承诺与客户端生成的是否完全吻合
            assertEq(realRegistry.dkgCommitments(auditor, 0), commitments[0]);
            assertEq(realRegistry.dkgCommitments(auditor, 1), commitments[1]);
            assertEq(realRegistry.dkgCommitments(auditor, 2), commitments[2]);

            // 验证分发给第 5 个审计节点的加密碎片是否吻合
            assertEq(realRegistry.encryptedShares(auditor, realAuditors[4]), shares[4]);
        }

        // 5. 提取客户端生成的全局审计公钥，并在链上进行 Finalize 公示
        bytes memory globalPubKey = json.readBytes(".global_public_key");
        
        vm.prank(realAuditors[0]);
        realRegistry.finalizeGlobalPublicKey(globalPubKey);

        // 6. 验证链上公示的全局审计公钥与客户端通过 DKG 算法聚合计算出的公钥完全吻合
        assertTrue(realRegistry.isDkgCompleted());
        assertEq(realRegistry.globalAuditPublicKey(), globalPubKey);
    }
}
