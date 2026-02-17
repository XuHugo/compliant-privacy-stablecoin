# Privacy ERC20 Scripts provided

## `compile_circuits.sh`

This script automates the process of:
1. Compiling the Circom circuit (`joinsplit.circom`).
2. Performing the Trusted Setup (Powers of Tau + Phase 2).
   - **Note**: This uses a dummy "random text" for entropy. In production, use a real ceremony.
3. Exporting the verification key (`verification_key.json`).
4. Generating the Solidity Verifier contract (`Verifier.sol`).

### usage
```bash
./scripts/compile_circuits.sh
```

## Prerequisities

You need to install:
- **Rus** (for the client)
- **Circom**: `cargo install --git https://github.com/iden3/circom.git`
- **SnarkJS**: `npm install -g snarkjs`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile circuits:
   ```bash
   ./scripts/compile_circuits.sh
   ```

3. Build Rust client:
   ```bash
   cargo build --release
   ```
