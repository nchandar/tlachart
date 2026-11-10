const screen = {
	cart: "Cart",
	address: "Address",
	payment: "Paying",
	paid: "Paid",
};

const payment = (pending, charges) => {
	if (charges === 2) return "Charged twice";
	if (charges === 1) return pending ? "Charged once, one pending" : "Charged once";
	if (pending === 2) return "Two charges pending";
	return pending === 1 ? "One charge pending" : "No charge";
};

export const state = (v) => ({
	Screen: screen[v.step],
	Payment: payment(v.pending, v.charges),
});

export const step = (action) =>
	({
		ToAddress: "you go to the address step",
		ToPayment: "you go to payment",
		BackToCart: "you go back",
		BackToAddress: "you go back",
		YouPressPay: "you press Pay",
		YouDoubleClickPay: "you double-click Pay",
		ChargeCompletes: "the charge goes through",
		AnotherChargeCompletes: "the charge goes through",
		Done: null,
	})[action] ?? action;

export const title = "Checkout";
