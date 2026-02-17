// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @dev Poseidon 哈希函数的接口 (1个输入和2个输入版本)
 */
interface IPoseidon {
    function poseidon(uint256[1] calldata inputs) external pure returns (uint256);
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256);
}

// 注意：在实际生产环境中，Poseidon 合约通常是通过部署一段特殊的字节码来实现的，
// 因为其数学运算非常复杂。为了演示例程，我们可以通过接口调用已部署的 Poseidon 合约。
