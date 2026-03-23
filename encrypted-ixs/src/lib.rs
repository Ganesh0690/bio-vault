use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct MatchInput {
        contact1_a: u128,
        contact2_a: u128,
        contact1_b: u128,
        contact2_b: u128,
        count: u8,
    }

    pub struct MatchResult {
        matches_found: u8,
        compared: u8,
    }

    #[instruction]
    pub fn find_matches(input: Enc<Shared, MatchInput>) -> Enc<Shared, MatchResult> {
        let d = input.to_arcis();
        let mut matches_found: u8 = 0;
        let mut compared: u8 = 0;

        let v1 = 0 < d.count;
        if v1 { compared = compared + 1; }
        let m1a = d.contact1_a == d.contact1_b;
        let m1b = d.contact1_a == d.contact2_b;
        if v1 && (m1a || m1b) { matches_found = matches_found + 1; }

        let v2 = 1 < d.count;
        if v2 { compared = compared + 1; }
        let m2a = d.contact2_a == d.contact1_b;
        let m2b = d.contact2_a == d.contact2_b;
        if v2 && (m2a || m2b) { matches_found = matches_found + 1; }

        let result = MatchResult { matches_found, compared };
        input.owner.from_arcis(result)
    }
}
