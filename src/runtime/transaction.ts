export class RuntimeTransaction {
  readonly #rollbacks: Array<() => Promise<void>> = [];
  #finished = false;

  addRollback(rollback: () => Promise<void>): void {
    if (this.#finished) throw new Error('Runtime transaction is already finished');
    this.#rollbacks.push(rollback);
  }

  async commit(): Promise<void> {
    this.#finished = true;
    this.#rollbacks.length = 0;
  }

  async rollback(): Promise<void> {
    if (this.#finished) return;
    const errors: unknown[] = [];
    for (const rollback of this.#rollbacks.reverse()) {
      try { await rollback(); } catch (error) { errors.push(error); }
    }
    this.#finished = true;
    if (errors.length > 0) throw new AggregateError(errors, 'Runtime rollback was incomplete');
  }
}

export async function withRuntimeTransaction<T>(operation: (transaction: RuntimeTransaction) => Promise<T>): Promise<T> {
  const transaction = new RuntimeTransaction();
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try { await transaction.rollback(); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Operation and rollback both failed');
    }
    throw error;
  }
}
