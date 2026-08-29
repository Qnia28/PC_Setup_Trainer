import { describe, expect, it } from "vitest";
import { SolverWorkerClient } from "../../../src/solver/worker-client.mjs";

interface WorkerRequestMessage {
  id: number;
  kind: string;
  input: unknown;
}

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly requests: WorkerRequestMessage[] = [];
  terminated = false;

  postMessage(message: WorkerRequestMessage): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(value: unknown, recycle = false): void {
    const request = this.requests.at(-1);
    if (!request) throw new Error("No request to answer.");
    this.onmessage?.({ data: { id: request.id, ok: true, value, recycle } } as MessageEvent);
  }

  fail(message: string, recycle = false): void {
    const request = this.requests.at(-1);
    if (!request) throw new Error("No request to answer.");
    this.onmessage?.({ data: { id: request.id, ok: false, error: { name: "Error", message }, recycle } } as MessageEvent);
  }
}

function clientHarness(): { client: SolverWorkerClient; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const client = new SolverWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { client, workers };
}

describe("SolverWorkerClient lifecycle", () => {
  it("keeps an idle Worker across cancellation and later requests", async () => {
    const { client, workers } = clientHarness();
    const firstWorker = workers[0]!;
    const first = client.request<string>("solve-one", { queue: "TILJO" });
    firstWorker.respond("first");
    await expect(first).resolves.toBe("first");

    client.cancel();
    expect(firstWorker.terminated).toBe(false);

    const second = client.request<string>("solve-one", { queue: "OJLIT" });
    expect(workers).toHaveLength(1);
    firstWorker.respond("second");
    await expect(second).resolves.toBe("second");
    client.dispose();
  });

  it("terminates an active cancelled Worker and lazily creates its replacement", async () => {
    const { client, workers } = clientHarness();
    const firstWorker = workers[0]!;
    const first = client.request<string>("solve-one", { queue: "TILJO" });
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    client.cancel();
    await rejected;
    expect(firstWorker.terminated).toBe(true);
    expect(workers).toHaveLength(1);

    const second = client.request<string>("solve-one", { queue: "OJLIT" });
    expect(workers).toHaveLength(2);
    workers[1]!.respond("second");
    await expect(second).resolves.toBe("second");
    client.dispose();
  });

  it("recycles an over-limit Worker only after returning its completed result", async () => {
    const { client, workers } = clientHarness();
    const firstWorker = workers[0]!;
    const first = client.request<string>("per-save-minimals", { queue: "TILJOSZ" });
    firstWorker.respond("complete", true);
    await expect(first).resolves.toBe("complete");
    expect(firstWorker.terminated).toBe(true);

    const second = client.request<string>("per-save-minimals", { queue: "ZSOJLIT" });
    expect(workers).toHaveLength(2);
    workers[1]!.respond("next");
    await expect(second).resolves.toBe("next");
    client.dispose();
  });

  it("recycles an adaptive Worker after returning an error and replaces it lazily", async () => {
    const { client, workers } = clientHarness();
    const firstWorker = workers[0]!;
    const first = client.request("minimals", { pattern: "*p7" });
    firstWorker.fail("HiGHS load failed", true);
    await expect(first).rejects.toThrow("HiGHS load failed");
    expect(firstWorker.terminated).toBe(true);

    const second = client.request<string>("minimals", { pattern: "*p7" });
    expect(workers).toHaveLength(2);
    workers[1]!.respond("recovered");
    await expect(second).resolves.toBe("recovered");
    client.dispose();
  });
});
