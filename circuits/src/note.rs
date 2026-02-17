//! # Note (票据) 模块
//!
//! 定义隐私 ERC20 中的核心数据结构 Note，以及相关的承诺和 Nullifier 计算。
//! 使用 Arkworks BN254 和 Poseidon (Circom 兼容)。

use crate::poseidon::{poseidon_hash_2, poseidon_hash_3};
use ark_bn254::Fr;
use ark_ff::{Field, PrimeField, UniformRand};
use rand::rngs::OsRng;
use ark_std::Zero;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// 域元素类型 (BN254 Fr)
pub type FE = Fr;

/// 序列化助手: 将 FE 转换为十进制字符串 (Circom 格式)
pub fn fe_to_string<S>(fe: &FE, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&fe.to_string())
}

/// No-op deserializer (we mostly need serialization for inputs)
pub fn string_to_fe<'de, D>(deserializer: D) -> Result<FE, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    FE::from_str(&s).map_err(|_| serde::de::Error::custom("FieldElement parse error"))
}

/// Note (票据) - 代表一笔加密的资金
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Note {
    /// 金额 (以最小单位表示)
    pub amount: u64,
    /// 秘密值 (由用户私钥派生)
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub secret: FE,
    /// 盲化因子 (随机数)
    #[serde(serialize_with = "fe_to_string", deserialize_with = "string_to_fe")]
    pub blinding: FE,
}

impl Note {
    /// 创建新的 Note
    pub fn new(amount: u64, secret: FE, blinding: FE) -> Self {
        Self {
            amount,
            secret,
            blinding,
        }
    }

    /// 计算 Note 的承诺值
    ///
    /// Commitment = Poseidon(amount, secret, blinding)
    pub fn commitment(&self) -> FE {
        let amount_fe = FE::from(self.amount);
        // 使用 Poseidon(3)
        poseidon_hash_3([amount_fe, self.secret, self.blinding])
    }

    /// 计算 Note 的 Nullifier
    ///
    /// Nullifier = Poseidon(secret, leaf_index)
    /// 用于防止同一个 Note 被花费两次
    pub fn nullifier(&self, leaf_index: u64) -> FE {
        let index_fe = FE::from(leaf_index);
        // 使用 Poseidon(2)
        poseidon_hash_2([self.secret, index_fe])
    }
}

/// 从随机源生成域元素
pub fn random_field_element() -> FE {
    let mut rng = OsRng;
    FE::rand(&mut rng)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_commitment() {
        let secret = random_field_element();
        let blinding = random_field_element();
        let note = Note::new(1000, secret, blinding);

        let commitment = note.commitment();

        // 承诺值应该是确定性的
        let commitment2 = note.commitment();
        assert_eq!(commitment, commitment2);
    }

    #[test]
    fn test_note_nullifier_uniqueness() {
        let secret = random_field_element();
        let blinding = random_field_element();
        let note = Note::new(1000, secret, blinding);

        // 不同的 leaf_index 应该产生不同的 nullifier
        let nullifier_0 = note.nullifier(0);
        let nullifier_1 = note.nullifier(1);

        assert_ne!(nullifier_0, nullifier_1);
    }
}
