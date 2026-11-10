const label = {
	placed: "Placed",
	paid: "Paid",
	shipped: "Shipped",
	cancelled: "Cancelled",
	refunded: "Refunded",
};

export const state = (v) => label[v.status];

export const step = (action) =>
	({
		Pay: "you pay",
		Ship: "the order ships",
		Cancel: "you cancel",
		RequestRefund: "you ask for a refund",
		Done: null,
	})[action] ?? action;

export const group = (v) =>
	v.status === "cancelled" || v.status === "refunded" ? "Closed" : "Open";

export const colors = { Open: "blue", Closed: "tan" };

export const title = "Order lifecycle";
