const waiting = (v) => (v.timedOut ? "Waiting after a retry" : "Waiting for the reply");

const client = (v) =>
	v.client === "waiting"
		? waiting(v)
		: {
				idle: "Idle",
				sending: "Sending",
				backoff: "Backing off",
				settled: "Settled",
			}[v.client];

const server = (applied) =>
	applied === 2 ? "Charged twice" : applied === 1 ? "Charged once" : "Not charged";

export const state = (v) => ({
	Client: client(v),
	Server: server(v.applied),
});

export const step = (action) =>
	({
		YouPressPay: "you press Pay",
		ServerReceives: "the server takes the request",
		Timeout: "the request times out",
		Retry: "the client retries",
		ReplyArrives: "the reply arrives",
		Done: null,
	})[action] ?? action;

export const title = "Retry after a timeout";
