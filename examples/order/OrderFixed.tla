---- MODULE OrderFixed ----
\* Order lifecycle: a refund is allowed only after payment.
VARIABLES status, paidEver
vars == <<status, paidEver>>

Init ==
  /\ status = "placed"
  /\ paidEver = FALSE

Pay ==
  /\ status = "placed"
  /\ status' = "paid"
  /\ paidEver' = TRUE

Ship ==
  /\ status = "paid"
  /\ status' = "shipped"
  /\ UNCHANGED paidEver

Cancel ==
  /\ status \in {"placed", "paid"}
  /\ status' = "cancelled"
  /\ UNCHANGED paidEver

RequestRefund ==
  /\ status \in {"paid", "shipped"}
  /\ status' = "refunded"
  /\ UNCHANGED paidEver

Done ==
  /\ status \in {"cancelled", "refunded"}
  /\ UNCHANGED vars

Next == Pay \/ Ship \/ Cancel \/ RequestRefund \/ Done

Spec == Init /\ [][Next]_vars

\* No refund before payment.
NoRefundBeforePayment ==
  status /= "refunded" \/ paidEver
====
