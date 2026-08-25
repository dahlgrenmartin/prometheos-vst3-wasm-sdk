# Prometheos VST3 WASM SDK notices

Copyright (c) 2026 Prometheos contributors.

This repository is distributed under the MIT License; see `LICENSE`.

This project fetches the Steinberg VST3 SDK root at immutable revision
`3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96` (upstream
`v3.8.1_build_84`) and only its required `pluginterfaces` submodule at
revision `4f547e8e102b47de4a8b8aaf343c73b700786372`. Both source trees are
licensed under the MIT License by Steinberg Media Technologies GmbH, and
their copyright and license notices remain in the fetched source trees.

The bootstrap does not fetch the unrelated `base`, `cmake`, `doc`,
`public.sdk`, `tutorials`, or `vstgui4` submodules.

SDK-owned source and documentation in this repository are MIT-licensed. The
package suffix `.webvst` is used descriptively and is not presented as a
trademark claim. A naming/trademark review remains required before any public
release or tag; no tag is created by this repository.
