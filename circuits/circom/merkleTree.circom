pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// Merkle Tree Checker
// Verifies that a leaf exists in the tree at the given path
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hashes[levels];
    signal intermediate[levels + 1];
    signal diffs[levels];

    intermediate[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        hashes[i] = Poseidon(2);

        diffs[i] <== pathElements[i] - intermediate[i];
        
        // input[0] = (pathElements[i] - intermediate[i]) * pathIndices[i] + intermediate[i]
        // If index == 0: out = intermediate[i] (leaf is left)
        // If index == 1: out = pathElements[i] (leaf is right)
        hashes[i].inputs[0] <== diffs[i] * pathIndices[i] + intermediate[i];
        
        // input[1] = (intermediate[i] - pathElements[i]) * pathIndices[i] + pathElements[i]
        // If index == 0: out = pathElements[i] (sibling is right)
        // If index == 1: out = intermediate[i] (sibling is left)
        hashes[i].inputs[1] <== -diffs[i] * pathIndices[i] + pathElements[i];

        intermediate[i + 1] <== hashes[i].out;
    }

    root === intermediate[levels];
}
