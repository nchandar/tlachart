# Security policy

## Supported versions

Only the latest 0.x release gets fixes. Pin a version if you need stability.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: the repository's **Security** tab, then **Report a
vulnerability**. Do not open a public issue for a vulnerability.

Include what you need to make it reproducible: the tlachart version, your OS, the spec and view
you ran, the command, and what you saw. If the spec is the trigger, say what it does.

Expect an acknowledgement within a few days. I fix what is in scope and credit you unless you ask
otherwise.

## Scope

In scope: the `tlachart` command in this repository, including how it spawns TLC, handles output
folders and escapes text.

Out of scope: TLC, the Java runtime and Mermaid themselves, which you should report upstream. Also
out of scope by design: a spec, its config, a jar beside the spec or a `--view` module running as
you. That is what the command does. See "Trust model" in the README.
