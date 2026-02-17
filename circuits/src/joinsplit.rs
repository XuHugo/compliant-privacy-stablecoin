//! # JoinSplit 电路模块
//!
//! 实现隐私转账的核心零知识电路 inputs 结构和本地验证逻辑。
//! 使用 Arkworks BN254。

use crate::merkle::MerklePath;
use crate::note::{fe_to_string, string_to_fe, FE, Note};
use crate::poseidon::poseidon_hash_2;
use ark_ff::Field;
use ark_std::One;
use ark_std::Zero;
use serde::{Deserialize, Serialize};

/// JoinSplit 电路的公开输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicInputs {
    /// Merkle 树根
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub merkle_root: FE,
    /// 第一个输入的 Nullifier
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub nullifier_1: FE,
    /// 第二个输入的 Nullifier
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub nullifier_2: FE,
    /// 第一个输出的 Commitment
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub commitment_1: FE,
    /// 第二个输出的 Commitment
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub commitment_2: FE,
    /// 公开金额 (正=存入, 负=提取)
    pub public_amount: i64,
    /// 中继者手续费
    pub fee: u64,
}

/// JoinSplit 电路的私有输入 (Witness)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateInputs {
    // 输入 Note 1
    pub in_amount_1: u64,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub in_secret_1: FE,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub in_blinding_1: FE,
    pub in_path_1: MerklePath,
    pub in_leaf_index_1: u64,

    // 输入 Note 2
    pub in_amount_2: u64,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub in_secret_2: FE,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub in_blinding_2: FE,
    pub in_path_2: MerklePath,
    pub in_leaf_index_2: u64,

    // 输出 Note 1
    pub out_amount_1: u64,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub out_secret_1: FE,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub out_blinding_1: FE,

    // 输出 Note 2
    pub out_amount_2: u64,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub out_secret_2: FE,
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub out_blinding_2: FE,
}

/// JoinSplit 电路
///
/// 用于生成和验证隐私转账的 ZK 证明
pub struct JoinSplitCircuit {
    pub public_inputs: PublicInputs,
    pub private_inputs: PrivateInputs,
}

impl JoinSplitCircuit {
    /// 创建新的 JoinSplit 电路实例
    pub fn new(public_inputs: PublicInputs, private_inputs: PrivateInputs) -> Self {
        Self {
            public_inputs,
            private_inputs,
        }
    }

    /// 验证电路约束（不生成证明，仅做本地验证）
    ///
    /// 用于在生成证明前检查 witness 是否满足约束
    pub fn verify_constraints(&self) -> Result<(), CircuitError> {
        // 约束 1: 余额守恒
        self.verify_balance_conservation()?;

        // 约束 2: 输入 Note 1 的 Merkle 成员证明
        self.verify_merkle_membership_1()?;

        // 约束 3: 输入 Note 2 的 Merkle 成员证明
        self.verify_merkle_membership_2()?;

        // 约束 4: Nullifier 1 正确性
        self.verify_nullifier_1()?;

        // 约束 5: Nullifier 2 正确性
        self.verify_nullifier_2()?;

        // 约束 6: 输出 Commitment 1 正确性
        self.verify_commitment_1()?;

        // 约束 7: 输出 Commitment 2 正确性
        self.verify_commitment_2()?;

        Ok(())
    }

    /// 验证余额守恒
    fn verify_balance_conservation(&self) -> Result<(), CircuitError> {
        let input_sum = self.private_inputs.in_amount_1 as i128
            + self.private_inputs.in_amount_2 as i128
            + self.public_inputs.public_amount as i128;

        let output_sum = self.private_inputs.out_amount_1 as i128
            + self.private_inputs.out_amount_2 as i128
            + self.public_inputs.fee as i128;

        if input_sum != output_sum {
            return Err(CircuitError::BalanceNotConserved {
                input_sum,
                output_sum,
            });
        }
        Ok(())
    }

    /// 验证输入 Note 1 的 Merkle 成员证明
    fn verify_merkle_membership_1(&self) -> Result<(), CircuitError> {
        let note = Note::new(
            self.private_inputs.in_amount_1,
            self.private_inputs.in_secret_1,
            self.private_inputs.in_blinding_1,
        );
        let commitment = note.commitment();

        if !self
            .private_inputs
            .in_path_1
            .verify(&commitment, &self.public_inputs.merkle_root)
        {
            return Err(CircuitError::InvalidMerklePath { input_index: 1 });
        }
        Ok(())
    }

    /// 验证输入 Note 2 的 Merkle 成员证明
    fn verify_merkle_membership_2(&self) -> Result<(), CircuitError> {
        let note = Note::new(
            self.private_inputs.in_amount_2,
            self.private_inputs.in_secret_2,
            self.private_inputs.in_blinding_2,
        );
        let commitment = note.commitment();

        if !self
            .private_inputs
            .in_path_2
            .verify(&commitment, &self.public_inputs.merkle_root)
        {
            return Err(CircuitError::InvalidMerklePath { input_index: 2 });
        }
        Ok(())
    }

    /// 验证 Nullifier 1 正确性
    fn verify_nullifier_1(&self) -> Result<(), CircuitError> {
        let note = Note::new(
            self.private_inputs.in_amount_1,
            self.private_inputs.in_secret_1,
            self.private_inputs.in_blinding_1,
        );
        let expected_nullifier = note.nullifier(self.private_inputs.in_leaf_index_1);

        if expected_nullifier != self.public_inputs.nullifier_1 {
            return Err(CircuitError::InvalidNullifier { input_index: 1 });
        }
        Ok(())
    }

    /// 验证 Nullifier 2 正确性
    fn verify_nullifier_2(&self) -> Result<(), CircuitError> {
        let note = Note::new(
            self.private_inputs.in_amount_2,
            self.private_inputs.in_secret_2,
            self.private_inputs.in_blinding_2,
        );
        let expected_nullifier = note.nullifier(self.private_inputs.in_leaf_index_2);

        if expected_nullifier != self.public_inputs.nullifier_2 {
            return Err(CircuitError::InvalidNullifier { input_index: 2 });
        }
        Ok(())
    }

    /// 验证输出 Commitment 1 正确性
    fn verify_commitment_1(&self) -> Result<(), CircuitError> {
        let note = Note::new(
            self.private_inputs.out_amount_1,
            self.private_inputs.out_secret_1,
            self.private_inputs.out_blinding_1,
        );
        let expected_commitment = note.commitment();

        if expected_commitment != self.public_inputs.commitment_1 {
            return Err(CircuitError::InvalidCommitment { output_index: 1 });
        }
        Ok(())
    }

    /// 验证输出 Commitment 2 正确性
    fn verify_commitment_2(&self) -> Result<(), CircuitError> {
        let note = Note::new(
            self.private_inputs.out_amount_2,
            self.private_inputs.out_secret_2,
            self.private_inputs.out_blinding_2,
        );
        let expected_commitment = note.commitment();

        if expected_commitment != self.public_inputs.commitment_2 {
            return Err(CircuitError::InvalidCommitment { output_index: 2 });
        }
        Ok(())
    }
}

/// 电路错误类型
#[derive(Debug, Clone, thiserror::Error)]
pub enum CircuitError {
    #[error("Balance not conserved: input_sum={input_sum}, output_sum={output_sum}")]
    BalanceNotConserved { input_sum: i128, output_sum: i128 },
    #[error("Invalid Merkle path for input {input_index}")]
    InvalidMerklePath { input_index: usize },
    #[error("Invalid nullifier for input {input_index}")]
    InvalidNullifier { input_index: usize },
    #[error("Invalid commitment for output {output_index}")]
    InvalidCommitment { output_index: usize },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle::MerkleTree;
    use crate::note::random_field_element;

    /// 创建一个完整的 JoinSplit 测试用例
    fn create_valid_joinsplit() -> JoinSplitCircuit {
        // 创建两个输入 Notes
        let in_secret_1 = random_field_element();
        let in_blinding_1 = random_field_element();
        let in_note_1 = Note::new(500, in_secret_1, in_blinding_1);

        let in_secret_2 = random_field_element();
        let in_blinding_2 = random_field_element();
        let in_note_2 = Note::new(300, in_secret_2, in_blinding_2);

        // 创建 Merkle 树并插入
        let mut tree = MerkleTree::new(4);
        let commitment_1 = in_note_1.commitment();
        let commitment_2 = in_note_2.commitment();
        let idx_1 = tree.insert(commitment_1);
        let idx_2 = tree.insert(commitment_2);

        let merkle_root = tree.root();
        let path_1 = tree.get_path(idx_1);
        let path_2 = tree.get_path(idx_2);

        // 创建两个输出 Notes (500 + 300 = 400 + 350 + 50 fee)
        let out_secret_1 = random_field_element();
        let out_blinding_1 = random_field_element();
        let out_note_1 = Note::new(400, out_secret_1, out_blinding_1);

        let out_secret_2 = random_field_element();
        let out_blinding_2 = random_field_element();
        let out_note_2 = Note::new(350, out_secret_2, out_blinding_2);

        let public_inputs = PublicInputs {
            merkle_root,
            nullifier_1: in_note_1.nullifier(idx_1 as u64),
            nullifier_2: in_note_2.nullifier(idx_2 as u64),
            commitment_1: out_note_1.commitment(),
            commitment_2: out_note_2.commitment(),
            public_amount: 0,
            fee: 50,
        };

        let private_inputs = PrivateInputs {
            in_amount_1: 500,
            in_secret_1,
            in_blinding_1,
            in_path_1: path_1,
            in_leaf_index_1: idx_1 as u64,

            in_amount_2: 300,
            in_secret_2,
            in_blinding_2,
            in_path_2: path_2,
            in_leaf_index_2: idx_2 as u64,

            out_amount_1: 400,
            out_secret_1,
            out_blinding_1,

            out_amount_2: 350,
            out_secret_2,
            out_blinding_2,
        };

        JoinSplitCircuit::new(public_inputs, private_inputs)
    }

    #[test]
    fn test_valid_joinsplit() {
        let circuit = create_valid_joinsplit();
        assert!(circuit.verify_constraints().is_ok());
    }

    #[test]
    fn test_invalid_balance() {
        let mut circuit = create_valid_joinsplit();
        // 修改输出金额，破坏余额守恒
        circuit.private_inputs.out_amount_1 = 999;

        let result = circuit.verify_constraints();
        assert!(matches!(
            result,
            Err(CircuitError::BalanceNotConserved { .. })
        ));
    }
}
