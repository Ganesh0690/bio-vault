# BioVault - Private Biometric Identity on Solana

Vendor-agnostic, privacy-preserving biometric authentication. Templates are secret-shared across Arcium MPC nodes. Apps learn only match or no-match — raw biometrics are never exposed.

Live Demo: https://bio-vault-sage.vercel.app
Program ID: HT5HKw83Ygj3dBKjvXgLXHGhrLZqsQN7eQ26A1cMUgfp (Solana Devnet)
Explorer: https://explorer.solana.com/address/HT5HKw83Ygj3dBKjvXgLXHGhrLZqsQN7eQ26A1cMUgfp?cluster=devnet

## The Problem

Biometric auth today is device-siloed and vendor-locked. Templates stored on centralized servers are honeypots for breaches. Users cannot port their identity across devices.

## How BioVault Solves It

1. User enrolls biometric template (fingerprint/face hash) — encrypted with Rescue cipher via x25519 ECDH
2. For authentication, live scan is encrypted and submitted alongside stored template to Solana program
3. Arcium MPC nodes compare template vs scan on secret-shared data — no node sees raw biometrics
4. BLS-signed callback publishes match/no-match result on-chain

## Real End-to-End MPC

- getMXEPublicKey: Fetches cluster x25519 key
- RescueCipher.encrypt: Encrypts template hash, live scan, threshold
- queue_computation: Submits via Solana program CPI
- awaitComputationFinalization: Polls until ARX callback

## Privacy Guarantees

- Biometric secrecy: Raw templates never visible to any party
- Vendor agnostic: Works across any device or sensor
- Portable identity: Not hardware-bound
- On-chain proof: Every auth verified via BLS signature

## Tech Stack

Solana - Arcium - Arcis - Anchor 0.32.1 - React + Vite - Arcium Client SDK

## License

MIT
