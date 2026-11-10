// The environment a child process gets. A spec's TLC and a view module run as the user, so they see
// the variables the tool and its runtimes need and nothing else; a token in the user's shell stays
// out of reach.

// What a child may inherit, one reason each. Nothing here is a secret; anything else in the user's
// shell stays out.
const NAMES = new Set([
	"PATH", // finds the java, mise and shell tools the user already chose
	"HOME", // mise and Java read their per-user config and cache under it
	"USER", // Java reports it as user.name when the system lookup fails
	"LANG", // sets Java's default locale and file encoding
	"TMPDIR", // sends the child's temp files into the run's temp folder
	"JAVA_HOME", // picks the JDK the user installed instead of the first java on PATH
	"JAVA_TOOL_OPTIONS", // the JVM's own options, such as a heap bound or a trust store
	"TLA2TOOLS", // the user's jar, so mise can be skipped
	"JAVA", // the user's java binary, so mise can be skipped
	"TERM", // lets mise decide whether its progress output fits the terminal
]);
// Prefixes: LC_* is the user's locale, TLACHART_* the command's own test seams, MISE_* and XDG_*
// mise's settings, cache and data folders.
const PREFIXES = ["LC_", "TLACHART_", "MISE_", "XDG_"];

// Proxy and certificate variables for mise alone. mise downloads Java and TLC, so behind a corporate
// proxy it needs the proxy URL and the CA bundle; a proxy URL can carry credentials, so the view and
// TLC, which need no network, never get these.
const NETWORK = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"all_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"CURL_CA_BUNDLE",
];

const envOf = (
	extra: NodeJS.ProcessEnv,
	from: NodeJS.ProcessEnv,
	names: readonly string[],
): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(from))
		if (
			value !== undefined &&
			(NAMES.has(name) || names.includes(name) || PREFIXES.some((p) => name.startsWith(p)))
		)
			env[name] = value;
	return { ...env, ...extra };
};

/**
 * Copies the variables a child process may inherit from `from`, then applies `extra` on top, so a
 * caller can set a temp folder without widening the allowlist.
 */
export const childEnv = (extra: NodeJS.ProcessEnv = {}, from: NodeJS.ProcessEnv = process.env) =>
	envOf(extra, from, []);

/**
 * The environment for mise: the child allowlist plus proxy and certificate variables, so mise can
 * download the pinned Java and TLC behind a corporate proxy. Use it for mise only; no other child
 * needs the network.
 */
export const miseEnv = (extra: NodeJS.ProcessEnv = {}, from: NodeJS.ProcessEnv = process.env) =>
	envOf(extra, from, NETWORK);
