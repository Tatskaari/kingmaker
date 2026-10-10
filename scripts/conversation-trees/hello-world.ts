/** Runs in the host after the player agrees; never in the character model. */
export async function helloWorld(signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return "Hello world! The player agreed to help Aldren. Quest activation would run here.";
}
