use ark_bn254::Fr;
use ark_ff::Field;
use std::str::FromStr;
use scalarff::{Bn128FieldElement, FieldElement};
use poseidon_bn128::poseidon;
use num_bigint::BigUint;

// Bridge between Arkworks Fr and Poseidon's scalarff implementation

pub fn poseidon_hash_2(inputs: [Fr; 2]) -> Fr {
    let inputs_vec = vec![ark_fr_to_scalarff(inputs[0]), ark_fr_to_scalarff(inputs[1])];
    let res = poseidon(2, &inputs_vec).expect("Poseidon hash failed");
    scalarff_to_ark_fr(res)
}

pub fn poseidon_hash_3(inputs: [Fr; 3]) -> Fr {
    let inputs_vec = vec![
        ark_fr_to_scalarff(inputs[0]),
        ark_fr_to_scalarff(inputs[1]),
        ark_fr_to_scalarff(inputs[2]),
    ];
    let res = poseidon(3, &inputs_vec).expect("Poseidon hash failed");
    scalarff_to_ark_fr(res)
}

// Helpers

fn ark_fr_to_scalarff(fr: Fr) -> Bn128FieldElement {
    // arkworks display format can be "123" or "BigInt(123)". Let's check format.
    // Usually it's decimal string.
    
    // Safer:
    let bigint: num_bigint::BigUint = fr.into();
    Bn128FieldElement::from_biguint(&bigint)
}

fn scalarff_to_ark_fr(elem: Bn128FieldElement) -> Fr {
    let bigint = elem.to_biguint();
    let s = bigint.to_string();
    Fr::from_str(&s).expect("Failed to parse Fr from string")
}
