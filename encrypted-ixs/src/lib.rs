use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct BallotInput {
        choice: u8,
        stake_weight: u128,
        proposal_id: u128,
    }

    pub struct BallotResult {
        valid: u8,
        choice: u8,
        weight: u128,
    }

    #[instruction]
    pub fn submit_ballot(input: Enc<Shared, BallotInput>) -> Enc<Shared, BallotResult> {
        let b = input.to_arcis();
        let valid_choice = b.choice < 4;
        let valid_weight = b.stake_weight > 0;
        let valid_proposal = b.proposal_id > 0;
        let all_valid = valid_choice && valid_weight && valid_proposal;
        let valid: u8 = if all_valid { 1 } else { 0 };
        let result = BallotResult {
            valid,
            choice: b.choice,
            weight: b.stake_weight,
        };
        input.owner.from_arcis(result)
    }
}
