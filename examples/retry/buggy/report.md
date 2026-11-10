# Retry

TLC reached 8 states and 9 steps. The chart draws 9 states and 9 arrows.
The chart does not draw 2 steps that stay in one chart state.
The step the server takes the request changes Client and Server at the same time.

## AtMostOnce breaks
The shortest path has 5 steps:
0. Client Idle, Server Not charged
1. you press Pay: Client Sending, Server Not charged
2. the server takes the request: Client Waiting for the reply, Server Charged once
3. the request times out: Client Backing off, Server Charged once
4. the client retries: Client Sending, Server Charged once
5. the server takes the request: Client Waiting after a retry, Server Charged twice

## Rules that hold
NoDeadlock, EventuallySettles
