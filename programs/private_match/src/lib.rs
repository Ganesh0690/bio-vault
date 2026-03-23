use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

const COMP_DEF_OFFSET_FIND_MATCHES: u32 = comp_def_offset("find_matches");

declare_id!("3pVYFr4wuYy15Y32AqLYKiZ987sdzW3TmZaeAMjvdZrt");

#[arcium_program]
pub mod private_match {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        state.authority = ctx.accounts.authority.key();
        state.total_matches = 0;
        Ok(())
    }

    pub fn init_find_matches_comp_def(ctx: Context<InitFindMatchesCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://raw.githubusercontent.com/Ganesh0690/private-match/main/build/find_matches.arcis".to_string(),
                hash: circuit_hash!("find_matches"),
            })),
            None,
        )?;
        Ok(())
    }

    pub fn find_matches(
        ctx: Context<FindMatches>,
        computation_offset: u64,
        ct_contact1_a: [u8; 32],
        ct_contact2_a: [u8; 32],
        ct_contact1_b: [u8; 32],
        ct_contact2_b: [u8; 32],
        ct_count: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u128(ct_contact1_a)
            .encrypted_u128(ct_contact2_a)
            .encrypted_u128(ct_contact1_b)
            .encrypted_u128(ct_contact2_b)
            .encrypted_u8(ct_count)
            .build();
        let match_log_key = ctx.accounts.match_log.key();
        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![FindMatchesCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount { pubkey: match_log_key, is_writable: true }],
            )?],
            1, 0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "find_matches")]
    pub fn find_matches_callback(
        ctx: Context<FindMatchesCallback>,
        output: SignedComputationOutputs<FindMatchesOutput>,
    ) -> Result<()> {
        let _o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(FindMatchesOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };
        let log = &mut ctx.accounts.match_log;
        log.completed = true;
        emit!(MatchEvent { log_id: log.log_id });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + ProgramState::INIT_SPACE, seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("find_matches", payer)]
#[derive(Accounts)]
pub struct InitFindMatchesCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("find_matches", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct FindMatches<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed, space = 9, payer = payer, seeds = [&SIGN_PDA_SEED], bump, address = derive_sign_pda!())]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIND_MATCHES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    #[account(init, payer = payer, space = 8 + MatchLog::INIT_SPACE, seeds = [b"match_log", computation_offset.to_le_bytes().as_ref()], bump)]
    pub match_log: Account<'info, MatchLog>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("find_matches")]
#[derive(Accounts)]
pub struct FindMatchesCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_FIND_MATCHES))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub match_log: Account<'info, MatchLog>,
}

#[account]
#[derive(InitSpace)]
pub struct ProgramState {
    pub authority: Pubkey,
    pub total_matches: u64,
}

#[account]
#[derive(InitSpace)]
pub struct MatchLog {
    pub requester: Pubkey,
    pub log_id: u64,
    pub completed: bool,
}

#[event]
pub struct MatchEvent { pub log_id: u64 }

#[error_code]
pub enum ErrorCode {
    #[msg("Computation aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}
