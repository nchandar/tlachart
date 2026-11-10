---- MODULE RetryFixed ----
EXTENDS Naturals
\* Retry after a timeout: the server applies the charge once per idempotency key,
\* so a retried request is not charged again.
VARIABLES client, applied, seen, timedOut
vars == <<client, applied, seen, timedOut>>

Init ==
  /\ client = "idle"
  /\ applied = 0
  /\ seen = FALSE
  /\ timedOut = FALSE

YouPressPay ==
  /\ client = "idle"
  /\ client' = "sending"
  /\ UNCHANGED <<applied, seen, timedOut>>

ServerReceives ==
  /\ client = "sending"
  /\ applied' = IF seen THEN applied ELSE applied + 1
  /\ seen' = TRUE
  /\ client' = "waiting"
  /\ UNCHANGED timedOut

Timeout ==
  /\ client = "waiting"
  /\ ~timedOut
  /\ timedOut' = TRUE
  /\ client' = "backoff"
  /\ UNCHANGED <<applied, seen>>

Retry ==
  /\ client = "backoff"
  /\ client' = "sending"
  /\ UNCHANGED <<applied, seen, timedOut>>

ReplyArrives ==
  /\ client = "waiting"
  /\ client' = "settled"
  /\ UNCHANGED <<applied, seen, timedOut>>

Done ==
  /\ client = "settled"
  /\ UNCHANGED vars

Next ==
  \/ YouPressPay \/ ServerReceives \/ Timeout
  \/ Retry \/ ReplyArrives \/ Done

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

\* The charge is applied at most once.
AtMostOnce ==
  applied <= 1

\* The request eventually settles.
EventuallySettles ==
  <>(client = "settled")
====
