
// Override default prompts behavior to actually exit on ctrl + c
export const globalPromptOptions = {
    onCancel: (state: any) => process.exit(0)
}