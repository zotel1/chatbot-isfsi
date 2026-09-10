export interface ChatModelPort {

  generate(
    prompt: string
  ): Promise<string>;
}