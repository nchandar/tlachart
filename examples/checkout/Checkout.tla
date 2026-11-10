---- MODULE Checkout ----
EXTENDS Naturals
\* Checkout front end with one seeded bug: a double click on Pay sends two charge
\* requests, so the card can be charged twice.
VARIABLES step, pending, charges
vars == <<step, pending, charges>>

Init ==
  /\ step = "cart"
  /\ pending = 0
  /\ charges = 0

ToAddress ==
  /\ step = "cart"
  /\ step' = "address"
  /\ UNCHANGED <<pending, charges>>

ToPayment ==
  /\ step = "address"
  /\ step' = "payment"
  /\ UNCHANGED <<pending, charges>>

BackToCart ==
  /\ step = "address"
  /\ step' = "cart"
  /\ UNCHANGED <<pending, charges>>

BackToAddress ==
  /\ step = "payment"
  /\ pending = 0
  /\ step' = "address"
  /\ UNCHANGED <<pending, charges>>

YouPressPay ==
  /\ step = "payment"
  /\ pending = 0
  /\ pending' = 1
  /\ UNCHANGED <<step, charges>>

YouDoubleClickPay ==
  /\ step = "payment"
  /\ pending = 0
  /\ pending' = 2
  /\ UNCHANGED <<step, charges>>

ChargeCompletes ==
  /\ step = "payment"
  /\ pending = 1
  /\ pending' = 0
  /\ charges' = charges + 1
  /\ step' = "paid"

AnotherChargeCompletes ==
  /\ step = "payment"
  /\ pending = 2
  /\ pending' = 1
  /\ charges' = charges + 1
  /\ UNCHANGED step

Done ==
  /\ step = "paid"
  /\ UNCHANGED vars

Next ==
  \/ ToAddress \/ ToPayment \/ BackToCart \/ BackToAddress
  \/ YouPressPay \/ YouDoubleClickPay
  \/ ChargeCompletes \/ AnotherChargeCompletes \/ Done

Spec == Init /\ [][Next]_vars

\* The card is never charged twice.
NeverChargedTwice ==
  charges <= 1
====
