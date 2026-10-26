export interface IrisToolContext {
  signal?: AbortSignal;
}

export interface IrisTool<Input, Output> {
  readonly id: string;
  readonly description: string;
  parse(input: unknown): Input;
  execute(input: Input, context: IrisToolContext): Output | Promise<Output>;
}

export interface IrisToolSummary {
  id: string;
  description: string;
}

export class IrisToolRegistry {
  private readonly tools = new Map<string, IrisTool<unknown, unknown>>();

  register<Input, Output>(tool: IrisTool<Input, Output>): void {
    if (!tool.id.trim()) throw new Error('Uma ferramenta da IRIS precisa de um identificador.');
    if (this.tools.has(tool.id)) throw new Error(`A ferramenta "${tool.id}" já está registada.`);
    this.tools.set(tool.id, tool as IrisTool<unknown, unknown>);
  }

  list(): IrisToolSummary[] {
    return [...this.tools.values()].map(({ id, description }) => ({ id, description }));
  }

  async invoke(id: string, input: unknown, context: IrisToolContext = {}): Promise<unknown> {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`A ferramenta "${id}" não está registada.`);
    const parsed = tool.parse(input);
    return tool.execute(parsed, context);
  }
}
