import { useXpLedger } from '../store/xpLedger';

type BudgetOverrides = Pick<
  ReturnType<typeof useXpLedger.getState>,
  'setActiveNullifier' | 'canPerformAction' | 'consumeAction'
>;

export function createBudgetMock(overrides: BudgetOverrides) {
  const originalGetXpLedgerState = useXpLedger.getState;

  return {
    install() {
      useXpLedger.getState = () => ({
        ...originalGetXpLedgerState(),
        ...overrides
      });
    },
    restore() {
      useXpLedger.getState = originalGetXpLedgerState;
    }
  };
}
