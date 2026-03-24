# VeilDAO - Anonymous DAO Treasury Voting

Private governance for DAOs. Members vote on treasury allocations with encrypted ballots processed by Arcium MPC. Individual votes are permanently hidden — only aggregated results published on Solana.

Live Demo: https://veil-dao.vercel.app
Program ID: F1VtpPEhWZSn1fBdQ8ju5F7Rv4VPTfn8XHPi59cpiHa (Solana Devnet)
Explorer: https://explorer.solana.com/address/F1VtpPEhWZSn1fBdQ8ju5F7Rv4VPTfn8XHPi59cpiHa?cluster=devnet

## The Problem

DAO governance breaks when votes are observable before the tally. Whale tracking, vote-buying, and social pressure undermine democratic treasury decisions.

## How VeilDAO Solves It

1. Member encrypts their ballot (choice + stake weight + proposal ID) using Rescue cipher via x25519 ECDH with the MXE cluster
2. Encrypted ballot submitted to Solana program which queues Arcium MPC computation
3. ARX nodes validate the ballot on secret-shared data — no node sees the vote
4. BLS-signed callback confirms the computation on-chain

## Real End-to-End MPC

Every ballot triggers actual Arcium MPC computation using the official SDK:
- getMXEPublicKey: Fetches cluster x25519 key from Solana
- RescueCipher.encrypt: Encrypts choice, weight, proposal ID
- queue_computation: Submits encrypted data via Solana program CPI
- awaitComputationFinalization: Polls until ARX nodes complete and callback

## Privacy Guarantees

- Ballot secrecy: Individual votes never visible to any party
- Stake privacy: Voting power hidden during the process
- MPC enforcement: All computation on secret-shared data
- On-chain proof: Every ballot verified via BLS signature
- Full-threshold: ALL ARX nodes must collude to break privacy

## Technical Implementation

- Arcis Circuit: submit_ballot with BallotInput (choice u8, stake_weight u128, proposal_id u128)
- Solana Program: initialize, init_submit_ballot_comp_def (offchain circuit), submit_ballot, submit_ballot_callback
- Frontend: React + Vite + Arcium Client SDK (RescueCipher, x25519, awaitComputationFinalization)
- Offchain circuit hosted on GitHub for ARX node access

## Deployed on Solana Devnet

- Program: F1VtpPEhWZSn1fBdQ8ju5F7Rv4VPTfn8XHPi59cpiHa
- MXE: Initialized on cluster 456 with recovery set
- Comp Def: Offchain circuit source with verified hash

## Tech Stack

Solana - Arcium - Arcis - Anchor 0.32.1 - React + Vite - Arcium Client SDK

## License

MIT
