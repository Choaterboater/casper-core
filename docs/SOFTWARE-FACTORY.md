# Where the gate sits in a software factory

Dex Horthy's talk, [12 Rules for a Software Factory That Doesn't Ship Slop](https://www.youtube.com/watch?v=-NFMsM2y0Vk) (AI Engineer, November 2026), lays out twelve practices for running agents as a production system. The numbering below follows the talk's slides.

casper-core is one stage of that loop, not the loop. It is the back-pressure stage: the thing that decides whether work coming out of the build step can be called done. Most of the twelve rules are about the rest of the factory, and this document says which ones the gate keeps, which ones it hands to the host, and which ones it must refuse to absorb.

| # | Practice | What casper-core does |
| ---: | --- | --- |
| 1 | Loops = forward pressure + backpressure | It is back pressure. It cannot start work or route tickets; it only decides what leaves the build step. |
| 2 | Know your enemy: models do not maintain code | It makes no claim about maintainability. It reports whether a check distinguishes a change, nothing about whether the result is good code. |
| 3 | Plan before you build | Accepts `requirements` the caller declares and echoes which are still open. It never infers a plan. |
| 4 | Don't over-plan | Proof is opt-in per call. A prototype can use `run_checks`; only `--require-proof` or `require_proof` demands a counterfactual. |
| 5 | Align visually | Not here. A mockup is the host's job. |
| 6 | Help agents test their work | The exit code and facts are the feedback signal a host hill-climbs against. A refusal is useful, not a dead end. |
| 7 | Fight slop with deterministic tools | The whole product. A command exits 1 or it does not. The output is facts; the parity test and the facts-only formatter keep it that way. |
| 8 | Slop is a tool | The gate does not moralize. A comment-only change is refused as unproven, not as bad; the host decides whether to care. |
| 9 | Let models experiment | Out of scope. The gate is called after the experiment, not to run it. |
| 10 | Compound over time | `--json` makes every receipt storable. Keeping and evaluating them is the host's job; the core keeps no history. |
| 11 | Unify your forge | Out of scope. Decisions live where the team puts them. |
| 12 | You can't buy everything | The gate's central rule. It ships no test suite and no opinion about what good means. It runs your command against your baseline. |

## The two that explain the design

**7. Fight slop with deterministic tools.** A refusal is worth something only if it is mechanical. A model reviewing another model is another opinion; a command that fails without the change is evidence. This is why the gate has no prompt of its own and no repair loop: the moment it starts arguing, it becomes one more voice instead of a check.

**12. You can't buy everything.** The talk's claim is that verification cannot be sold as a black box, because only your team knows how your code should be tested. casper-core is the shell around that idea. It never claims to know what correct means; it asks for the command that decides, keeps a copy of the tree before the change, and reports what happened. Swap the repository and the gate has nothing to say, which is the point.

## The limit this document exists to state

The anti-slop manifesto that closes the talk is blunt about tools like this one: *agent reviewers, linters, and verifiers are useful, but they are not sufficient.*

casper-core is a verifier. It can show that a check distinguishes a change; it cannot show that the check is worth running, that the change is understandable, or that the code will still make sense in six months. Proof of a passing test is not a review, and the gate must never imply otherwise. That is why it prints facts instead of a verdict, and why "the gate passed" is not a sentence this repository will help you write.

The talk's own working definition is a good test for the tool itself: slop is when less effort goes into producing something than the reader has to spend understanding it. A gate that returns a wall of prose fails that test. Four lines of facts, or one refusal, is the whole output.
