# Checkout

TLC reached 8 states and 11 steps. The chart draws 10 states and 10 arrows.
The chart does not draw 2 steps that stay in one chart state.
The step the charge goes through changes Screen and Payment at the same time.

## NeverChargedTwice breaks
The shortest path has 5 steps:
0. Screen Cart, Payment No charge
1. you go to the address step: Screen Address, Payment No charge
2. you go to payment: Screen Paying, Payment No charge
3. you double-click Pay: Screen Paying, Payment Two charges pending
4. the charge goes through: Screen Paying, Payment Charged once, one pending
5. the charge goes through: Screen Paid, Payment Charged twice

## Rules that hold
NoDeadlock
