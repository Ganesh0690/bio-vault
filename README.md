# ShadowVote — Private Governance on Solana

> Votes are cast and tallied inside encrypted shared state. Only final results with correctness proofs are published to Solana.

**Live Demo:** https://shadow-vote.vercel.app  
**Program ID:** [H6NrSVGXBpp5jdrEAaLHuWLsmPUhMt9yK2uujQotNmKU](https://explorer.solana.com/address/H6NrSVGXBpp5jdrEAaLHuWLsmPUhMt9yK2uujQotNmKU?cluster=devnet) (Solana Devnet)

## The Problem

DAO governance suffers when votes are observable before the final tally. When votes are public during the voting period, participants face vote buying, coercion, and strategic voting based on partial results. Voters change their choices based on what others have voted, undermining the integrity of collective decision-making.

## The Solution

ShadowVote uses **Arcium's MPC network** to keep all ballots encrypted throughout the entire voting period. Votes are tallied inside encrypted shared state — no one, not even the MPC nodes individually, can see how anyone voted. Only the final aggregate result is revealed after voting ends.

## How Arcium Enables This

### Step 1: Encrypted Ballot
The voter's choice is encrypted using Arcium's **Rescue cipher** in CTR mode with 128-bit security. A **x25519 Diffie-Hellman key exchange** establishes a shared encryption key between the client and the MXE cluster. The ballot never exists in plaintext on-chain.

### Step 2: MPC Tallying via Arcium
The encrypted ballot and the current encrypted tally are submitted to Arcium's **ARX node network**. Using **secret sharing**, both are split into random-looking fragments across nodes. The nodes execute the cast_and_tally circuit — adding the vote to the running total — without any node learning the individual vote or the partial tally.

### Step 3: Aggregate Results Only
After voting ends, only the final aggregate counts are revealed. Individual votes remain permanently hidden. The MPC computation provides cryptographic correctness guarantees — the tally is provably accurate without exposing any ballot.

### Privacy Guarantees
- **Ballot secrecy:** No one sees how you voted — not other voters, not MPC nodes, not the DAO
- **Coercion resistance:** Voters cannot prove how they voted, preventing vote buying
- **Full-threshold security:** ALL ARX nodes would need to collude to break privacy
- **No partial results:** Running tallies are encrypted until the final reveal
- **On-chain verifiability:** Computation correctness verified via SignedComputationOutputs

## Architecture
```
Browser (Voter)
  |-- Select vote option
  |-- Generate x25519 keypair
  |-- Encrypt ballot with Rescue cipher (option_idx + weight)
  v
Solana Program [H6NrSVGXBpp5...on devnet]
  |-- Receive encrypted ballot + encrypted tally
  |-- Build computation arguments via ArgBuilder
  |-- Queue computation to Arcium (queue_computation CPI)
  v
Arcium MPC Cluster (ARX Nodes)
  |-- Convert ciphertexts to secret shares (.to_arcis())
  |-- Execute cast_and_tally circuit
  |-- Re-encrypt updated tally (.from_arcis())
  v
Callback to Solana Program
  |-- Verify signatures (SignedComputationOutputs)
  |-- Emit VoteCastEvent
  v
After Voting Period
  |-- Reveal final tally (finalize_proposal)
  |-- Emit ProposalFinalizedEvent with results
```

## Technical Implementation

### Arcis Circuit (encrypted-ixs/src/lib.rs)
The voting logic runs inside Arcium's MPC:
- **Ballot struct:** option_idx (u8) + weight (u128)
- **TallyState struct:** counts [u128; 8] + total_votes (u128)
- Circuit iterates over all 8 options, compares with ballot's selected option
- Adds weight to the matching option's count using secret-shared arithmetic
- Returns updated encrypted tally — no node sees plaintext ballot or running total
- Fixed iteration count (MPC security requirement prevents timing leaks)

### Solana Program (programs/shadow_vote/src/lib.rs)
- `initialize` — sets up program state
- `create_proposal` — creates on-chain proposal with title, description, options, deadline
- `init_cast_and_tally_comp_def` — registers MPC circuit on-chain
- `cast_vote` — encrypts and queues ballot via ArgBuilder + queue_computation
- `cast_and_tally_callback` — receives verified results via SignedComputationOutputs
- `finalize_proposal` — reveals final aggregate results after voting period
- Custom accounts: ProgramState, Proposal, VoteRecord

### Frontend (app/)
- React + TypeScript + Vite with Anchor SDK
- Real on-chain transactions (initialize, create proposal) on Solana Explorer
- Phantom wallet integration with devnet balance display
- Dark minimal UI with encrypted vote progress visualization
- Transaction history with Explorer links

## Project Structure
```
shadow-vote/
├── encrypted-ixs/src/lib.rs       -- Arcis MPC circuit (cast_and_tally)
├── programs/shadow_vote/
│   └── src/lib.rs                  -- Solana program with Arcium integration
├── build/
│   ├── cast_and_tally.arcis        -- Compiled MPC circuit
│   └── cast_and_tally.hash         -- Circuit hash for verification
├── app/
│   ├── src/App.tsx                 -- Frontend with on-chain calls
│   ├── src/idl/                    -- Program IDL for Anchor
│   └── src/index.css               -- Dark minimal UI
├── Anchor.toml                     -- Anchor configuration
└── Arcium.toml                     -- Arcium configuration
```

## Build and Deploy
```bash
curl --proto '=https' --tlsv1.2 -sSfL https://install.arcium.com/ | bash
arcium build --skip-keys-sync
anchor build
arcium deploy --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://api.devnet.solana.com
cd app && npm install && npm run dev
```

## How to Test

1. Install Phantom wallet, switch to Devnet
2. Get devnet SOL from faucet
3. Visit https://shadow-vote.vercel.app
4. Connect wallet
5. Click "Initialize" — real Solana devnet transaction
6. Click "+ New Proposal" — create governance proposal on-chain
7. Select a proposal, choose an option, click "Cast Encrypted Vote"
8. Watch the MPC computation progress
9. Verify transactions on Solana Explorer

## Deployed on Solana Devnet

- **Program:** H6NrSVGXBpp5jdrEAaLHuWLsmPUhMt9yK2uujQotNmKU
- **MXE:** Successfully initialized with cluster migration
- **Explorer:** https://explorer.solana.com/address/H6NrSVGXBpp5jdrEAaLHuWLsmPUhMt9yK2uujQotNmKU?cluster=devnet
- **Demo:** https://shadow-vote.vercel.app

## Tech Stack

Solana · Arcium · Arcis · Anchor 0.32.1 · React + Vite · Phantom

## License

MIT
