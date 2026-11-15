#!/usr/bin/env bash
# Bounded gate wrapper for the Stage 6 mutation pass.
#
# The mutation gate runs the project gate once per mutant. A mutant that turns
# a loop bound into an infinite loop would otherwise hang the pass forever:
# mutation_gate.py uses subprocess.run(shell=True), and on Windows killing the
# shell does not close the pipes the grandchild still holds, so its own timeout
# never fires. Wrapping the gate in coreutils `timeout` makes every mutant
# self-terminate, and a timeout exit (124) is correctly counted as a kill.
#
# Usage: python ../ask_gemini.py --mutation-baseline <sha> \
#          --mutation-gate "bash plans/mutation_gate.sh" --out plans/mutation_report.md

exec timeout 10 node test_colouring_book.js
