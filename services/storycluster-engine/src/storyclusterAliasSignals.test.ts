import { describe, expect, it } from 'vitest';
import { inferStoryclusterAliases } from './storyclusterAliasSignals';

describe('inferStoryclusterAliases', () => {
  it('adds stable aliases for the live public duplicate families', () => {
    expect(
      inferStoryclusterAliases('DOJ drops case against veteran arrested after burning U.S. flag near White House'),
    ).toContain('white_house_flag_burning_case');
    expect(
      inferStoryclusterAliases(
        "Judge says 'no evidence' to justify Federal Reserve probe",
        'A federal judge said there was no evidence for Justice Department subpoenas targeting Jerome Powell.',
      ),
    ).toContain('jerome_powell_subpoena_case');
    expect(
      inferStoryclusterAliases('Man charged for allegedly selling weapon to gunman in Virginia university attack'),
    ).toContain('old_dominion_attack_weapon_case');
    expect(
      inferStoryclusterAliases('The State Department Just Made It A Lot Cheaper For Americans To Give Up Citizenship'),
    ).toContain('citizenship_renunciation_fee_cut');
    expect(
      inferStoryclusterAliases('Prosecutor Drops Criminal Charge Against Teen After Teacher Dies In Prank Mishap'),
    ).toContain('teacher_prank_death_case');
  });

  it('matches alternate phrasing for the same duplicate families', () => {
    expect(
      inferStoryclusterAliases('DOJ seeks to drop White House flag burning case against Jan Carey'),
    ).toContain('white_house_flag_burning_case');
    expect(
      inferStoryclusterAliases(
        'DOJ says subpoenas of Fed chair lacked basis',
        'A judge blocked the subpoenas in the Federal Reserve probe.',
      ),
    ).toContain('jerome_powell_subpoena_case');
    expect(
      inferStoryclusterAliases('Man charged after selling gun to shooter in Old Dominion attack'),
    ).toContain('old_dominion_attack_weapon_case');
    expect(
      inferStoryclusterAliases('State Department reduced cost to renounce citizenship'),
    ).toContain('citizenship_renunciation_fee_cut');
    expect(
      inferStoryclusterAliases('Teacher prank death charge dropped after fatal mishap'),
    ).toContain('teacher_prank_death_case');
  });

  it('does not add aliases for unrelated headlines', () => {
    expect(
      inferStoryclusterAliases('State lawmakers grill former special prosecutor Nathan Wade over Georgia Trump election case'),
    ).toEqual([]);
  });
});
