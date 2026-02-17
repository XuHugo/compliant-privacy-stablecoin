#!/bin/bash
set -e

# Check if circom is installed
if ! command -v circom &> /dev/null
then
    echo "circom could not be found. Please install it: https://docs.circom.io/getting-started/installation/"
    exit 1
fi

# Check if snarkjs is installed
if ! command -v snarkjs &> /dev/null
then
    echo "snarkjs could not be found. Please install it: npm install -g snarkjs"
    exit 1
fi

CIRCUITS_DIR="./circuits/circom"
BUILD_DIR="./circuits/build"
CONTRACTS_DIR="./contracts/src"

mkdir -p $BUILD_DIR

echo "Compiling JoinSplit circuit..."
circom $CIRCUITS_DIR/joinsplit.circom --r1cs --wasm --sym --c --output $BUILD_DIR -l node_modules

echo "Generating Trusted Setup (Pot 16)..."
# Phase 1
snarkjs powersoftau new bn128 16 $BUILD_DIR/pot16_0000.ptau -v
snarkjs powersoftau contribute $BUILD_DIR/pot16_0000.ptau $BUILD_DIR/pot16_0001.ptau --name="First contribution" -v -e="random text"
snarkjs powersoftau prepare phase2 $BUILD_DIR/pot16_0001.ptau $BUILD_DIR/pot16_final.ptau -v

echo "Generating ZKey (Phase 2)..."
snarkjs groth16 setup $BUILD_DIR/joinsplit.r1cs $BUILD_DIR/pot16_final.ptau $BUILD_DIR/joinsplit_0000.zkey
snarkjs zkey contribute $BUILD_DIR/joinsplit_0000.zkey $BUILD_DIR/joinsplit_final.zkey --name="Second contribution" -v -e="another random text"
snarkjs zkey export verificationkey $BUILD_DIR/joinsplit_final.zkey $BUILD_DIR/verification_key.json

echo "Generating Solidity Verifier..."
snarkjs zkey export solidityverifier $BUILD_DIR/joinsplit_final.zkey $CONTRACTS_DIR/Verifier.sol

echo "Done! Verifier.sol generated in $CONTRACTS_DIR/Verifier.sol"
