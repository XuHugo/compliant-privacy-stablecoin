//! # Audit 模块
//!
//! 实现 3-of-5 门限椭圆曲线 ElGamal (Threshold EC-ElGamal) 加解密及 DKG（分布式密钥生成）机制。
//! 兼容 ark-bn254 和 ark-ff 库。

use ark_bn254::{Fr, G1Projective, G1Affine};
use ark_ec::{CurveGroup, Group};
use ark_ff::{PrimeField, UniformRand, Zero, One, Field};
use ark_serialize::{CanonicalSerialize, CanonicalDeserialize};
use rand::rngs::OsRng;
use sha2::{Sha256, Digest};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AuditError {
    #[error("DKG error: {0}")]
    DkgError(String),
    #[error("Threshold decryption error: {0}")]
    DecryptionError(String),
    #[error("Serialization error: {0}")]
    SerializationError(String),
}

/// DKG 中节点的本地秘密多项式 (t-1 = 2 次)
pub struct DkgPolynomial {
    pub node_id: usize,
    pub coefficients: Vec<Fr>,
}

impl DkgPolynomial {
    /// 创建新多项式，系数随机选择，a_0 为节点本地秘密值
    pub fn new(node_id: usize, threshold: usize) -> Self {
        let mut rng = OsRng;
        let mut coefficients = Vec::with_capacity(threshold);
        for _ in 0..threshold {
            coefficients.push(Fr::rand(&mut rng));
        }
        Self {
            node_id,
            coefficients,
        }
    }

    /// 评估多项式 f(x)
    pub fn evaluate(&self, x: Fr) -> Fr {
        let mut result = Fr::zero();
        // Horner 算法评估多项式
        for coeff in self.coefficients.iter().rev() {
            result = result * x + coeff;
        }
        result
    }

    /// 生成节点公钥承诺 (A_i,j = a_i,j * G)
    pub fn commitments(&self) -> Vec<G1Projective> {
        let g = G1Projective::generator();
        self.coefficients
            .iter()
            .map(|coeff| g * coeff)
            .collect()
    }
}

/// 节点的私钥碎片
#[derive(Clone, Debug, PartialEq)]
pub struct PrivateKeyShare {
    pub node_id: usize,
    pub share: Fr,
}

impl PrivateKeyShare {
    /// 聚合从所有节点接收到的多项式碎片评估值，合成最终私钥碎片 sk_j
    pub fn aggregate(shares_received: &[Fr], node_id: usize) -> Self {
        let mut total_share = Fr::zero();
        for share in shares_received {
            total_share += share;
        }
        Self {
            node_id,
            share: total_share,
        }
    }

    /// 序列化为字节流
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(self.node_id as u64).to_le_bytes());
        self.share.serialize_compressed(&mut bytes).unwrap();
        bytes
    }

    /// 从字节流反序列化
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, AuditError> {
        if bytes.len() < 8 {
            return Err(AuditError::SerializationError("Invalid bytes length".to_string()));
        }
        let node_id = u64::from_le_bytes(bytes[0..8].try_into().unwrap()) as usize;
        let share = Fr::deserialize_compressed(&bytes[8..]).map_err(|e| {
            AuditError::SerializationError(format!("Failed to deserialize share: {}", e))
        })?;
        Ok(Self { node_id, share })
    }
}

/// 全局审计公钥 (PK_global)
#[derive(Clone, Debug, PartialEq)]
pub struct AuditPublicKey {
    pub point: G1Projective,
}

impl AuditPublicKey {
    /// 聚合所有审计节点的承诺 A_i,0 生成全局公钥
    pub fn aggregate(nodes_commitments_a0: &[G1Projective]) -> Self {
        let mut total_point = G1Projective::zero();
        for point in nodes_commitments_a0 {
            total_point += point;
        }
        Self { point: total_point }
    }

    /// 序列化为字节流
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        self.point.serialize_compressed(&mut bytes).unwrap();
        bytes
    }

    /// 从字节流反序列化
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, AuditError> {
        let point = G1Projective::deserialize_compressed(bytes).map_err(|e| {
            AuditError::SerializationError(format!("Failed to deserialize public key: {}", e))
        })?;
        Ok(Self { point })
    }
}

/// 被加密的审计对称密钥 (C_key)
#[derive(Clone, Debug, PartialEq)]
pub struct EncryptedAuditKey {
    pub ephemeral_public: G1Projective,
    pub masked_key: Fr,
}

impl EncryptedAuditKey {
    /// 使用全局公钥加密对称密钥 sym_key
    pub fn encrypt(pub_key: &AuditPublicKey, sym_key: Fr) -> Self {
        let mut rng = OsRng;
        let r = Fr::rand(&mut rng);
        let g = G1Projective::generator();

        // R = r * G
        let ephemeral_public = g * r;

        // S = r * PK_global
        let shared_secret = pub_key.point * r;

        // 从 S 派生 K_deriv
        let k_deriv = Self::derive_k_blinding(shared_secret);

        // C_m = sym_key + K_deriv
        let masked_key = sym_key + k_deriv;

        Self {
            ephemeral_public,
            masked_key,
        }
    }

    /// 节点生成自己部分的解密份额 D_j = sk_j * R
    pub fn decrypt_share(&self, priv_share: &PrivateKeyShare) -> DecryptionShare {
        let share_point = self.ephemeral_public * priv_share.share;
        DecryptionShare {
            node_id: priv_share.node_id,
            share_point,
        }
    }

    /// 使用至少 3 个解密份额，还原 sym_key
    pub fn decrypt(&self, shares: &[DecryptionShare]) -> Result<Fr, AuditError> {
        if shares.len() < 3 {
            return Err(AuditError::DecryptionError(format!(
                "Insufficient decryption shares: got {}, need at least 3",
                shares.len()
            )));
        }

        // 收集参与者 ID 集合 U
        let u: Vec<usize> = shares.iter().map(|s| s.node_id).collect();

        // 重组共享秘密 S = \sum \lambda_j * D_j
        let mut shared_secret = G1Projective::zero();

        for share in shares {
            let lambda_j = Self::lagrange_coefficient(share.node_id, &u)?;
            shared_secret += share.share_point * lambda_j;
        }

        // 派生致盲因子
        let k_deriv = Self::derive_k_blinding(shared_secret);

        // sym_key = C_m - K_deriv
        let sym_key = self.masked_key - k_deriv;

        Ok(sym_key)
    }

    /// 序列化为字节流
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        self.ephemeral_public.serialize_compressed(&mut bytes).unwrap();
        self.masked_key.serialize_compressed(&mut bytes).unwrap();
        bytes
    }

    /// 从字节流反序列化
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, AuditError> {
        let mut cursor = bytes;
        let ephemeral_public = G1Projective::deserialize_compressed(&mut cursor).map_err(|e| {
            AuditError::SerializationError(format!("Failed to deserialize ephemeral public point: {}", e))
        })?;
        let masked_key = Fr::deserialize_compressed(&mut cursor).map_err(|e| {
            AuditError::SerializationError(format!("Failed to deserialize masked key: {}", e))
        })?;
        Ok(Self { ephemeral_public, masked_key })
    }

    /// 链下派生 K_deriv Blinding Scalar 逻辑
    fn derive_k_blinding(point: G1Projective) -> Fr {
        let affine = point.into_affine();
        let mut x_bytes = Vec::new();
        affine.x.serialize_compressed(&mut x_bytes).unwrap();

        let mut hasher = Sha256::new();
        hasher.update(&x_bytes);
        let hash_result = hasher.finalize();

        // 兼容有限域的大小取模转换为域元素
        Fr::from_le_bytes_mod_order(&hash_result)
    }

    /// 在 x = 0 处计算 Lagrange 插值系数
    fn lagrange_coefficient(j: usize, u: &[usize]) -> Result<Fr, AuditError> {
        let x_j = Fr::from(j as u64);
        let mut num = Fr::one();
        let mut den = Fr::one();

        for &k in u {
            if k == j {
                continue;
            }
            let x_k = Fr::from(k as u64);
            num *= x_k;
            den *= x_k - x_j;
        }

        if den.is_zero() {
            return Err(AuditError::DecryptionError(
                "Lagrange denominator is zero".to_string(),
            ));
        }

        let den_inv = den.inverse().ok_or_else(|| {
            AuditError::DecryptionError("Lagrange denominator inverse failed".to_string())
        })?;

        Ok(num * den_inv)
    }
}

/// 审计节点生成的局部解密份额
#[derive(Clone, Debug, PartialEq)]
pub struct DecryptionShare {
    pub node_id: usize,
    pub share_point: G1Projective,
}

impl DecryptionShare {
    /// 序列化为字节流
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(self.node_id as u64).to_le_bytes());
        self.share_point.serialize_compressed(&mut bytes).unwrap();
        bytes
    }

    /// 从字节流反序列化
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, AuditError> {
        if bytes.len() < 8 {
            return Err(AuditError::SerializationError("Invalid bytes length".to_string()));
        }
        let node_id = u64::from_le_bytes(bytes[0..8].try_into().unwrap()) as usize;
        let share_point = G1Projective::deserialize_compressed(&bytes[8..]).map_err(|e| {
            AuditError::SerializationError(format!("Failed to deserialize share point: {}", e))
        })?;
        Ok(Self { node_id, share_point })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dkg_and_threshold_decryption_flow() {
        // 5 个节点
        let mut polynomials = Vec::new();
        for id in 1..=5 {
            polynomials.push(DkgPolynomial::new(id, 3));
        }

        // 1. 节点间安全分发碎片 (模拟链上公告板的交换)
        // shares_matrix[sender][receiver]
        let mut shares_matrix = vec![vec![Fr::zero(); 6]; 6];
        for i in 1..=5 {
            for j in 1..=5 {
                let x = Fr::from(j as u64);
                shares_matrix[i][j] = polynomials[i - 1].evaluate(x);
            }
        }

        // 2. 节点各自求和生成自己的最终私钥碎片 sk_j
        let mut private_shares = Vec::new();
        for j in 1..=5 {
            let mut j_shares = Vec::new();
            for i in 1..=5 {
                j_shares.push(shares_matrix[i][j]);
            }
            private_shares.push(PrivateKeyShare::aggregate(&j_shares, j));
        }

        // 3. 聚合生成全局审计公钥
        let mut a0_commitments = Vec::new();
        for poly in &polynomials {
            a0_commitments.push(poly.commitments()[0]);
        }
        let global_pub_key = AuditPublicKey::aggregate(&a0_commitments);

        // 4. 用户加密对称审计密钥 sym_key
        let sym_key = Fr::from(123456789u64);
        let ciphertext = EncryptedAuditKey::encrypt(&global_pub_key, sym_key);

        // 5. 3/5 联合解密测试 (用 {1, 3, 5} 三个节点解密)
        let share1 = ciphertext.decrypt_share(&private_shares[0]); // node 1
        let share3 = ciphertext.decrypt_share(&private_shares[2]); // node 3
        let share5 = ciphertext.decrypt_share(&private_shares[4]); // node 5

        let decrypted_key = ciphertext
            .decrypt(&[share1.clone(), share3.clone(), share5.clone()])
            .unwrap();
        assert_eq!(decrypted_key, sym_key);

        // 6. 用另一个 3/5 组合 {2, 4, 5} 解密也应当成功
        let share2 = ciphertext.decrypt_share(&private_shares[1]); // node 2
        let share4 = ciphertext.decrypt_share(&private_shares[3]); // node 4

        let decrypted_key_2 = ciphertext
            .decrypt(&[share2.clone(), share4.clone(), share5.clone()])
            .unwrap();
        assert_eq!(decrypted_key_2, sym_key);

        // 7. 安全边界测试: 仅使用 2 个节点解密必然失败
        let failed_decryption = ciphertext.decrypt(&[share1.clone(), share3.clone()]);
        assert!(failed_decryption.is_err());
    }

    #[test]
    fn test_serialization_deserialization_roundtrip() {
        let mut rng = OsRng;
        
        // 1. PrivateKeyShare Roundtrip
        let sk_share = PrivateKeyShare {
            node_id: 3,
            share: Fr::rand(&mut rng),
        };
        let sk_bytes = sk_share.to_bytes();
        let sk_recovered = PrivateKeyShare::from_bytes(&sk_bytes).unwrap();
        assert_eq!(sk_share, sk_recovered);

        // 2. AuditPublicKey Roundtrip
        let g = G1Projective::generator();
        let pub_key = AuditPublicKey {
            point: g * Fr::rand(&mut rng),
        };
        let pub_bytes = pub_key.to_bytes();
        let pub_recovered = AuditPublicKey::from_bytes(&pub_bytes).unwrap();
        assert_eq!(pub_key, pub_recovered);

        // 3. EncryptedAuditKey Roundtrip
        let sym_key = Fr::from(987654321u64);
        let ciphertext = EncryptedAuditKey::encrypt(&pub_key, sym_key);
        let cipher_bytes = ciphertext.to_bytes();
        let cipher_recovered = EncryptedAuditKey::from_bytes(&cipher_bytes).unwrap();
        assert_eq!(ciphertext, cipher_recovered);

        // 4. DecryptionShare Roundtrip
        let dec_share = ciphertext.decrypt_share(&sk_share);
        let dec_bytes = dec_share.to_bytes();
        let dec_recovered = DecryptionShare::from_bytes(&dec_bytes).unwrap();
        assert_eq!(dec_share, dec_recovered);
    }
}
