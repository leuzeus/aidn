# Inventaire des motifs — deux smokes

Inventaire local fondé sur les traces complètes. Un champ absent est compté uniquement parmi les documents de la même famille, pas comme une raison manquante contractuellement. Les clés `reasoning*` désignent les tokens/effort du modèle et sont exclues des motifs. Les raw files AIDN sont une preuve secondaire de commandes déjà comptées; les répétitions dans normalized/payload/summary ne sont pas des décisions supplémentaires.

## Protocole natif Codex, AIDN et baseline

### run-aidn

| Événement et chemin | Occurrences | Null | État/interprétation |
| --- | ---: | ---: | --- |
| `mcpServer/startupStatus/updated $.params.failureReason` | 4 | 4 | starting/ready, aucun échec. |
| `hook/started $.params.run.statusMessage` | 131 | 131 | Champ natif; raisons AIDN dans entries.text, y compris refus. |
| `hook/completed $.params.run.statusMessage` | 131 | 131 | Champ natif; raisons AIDN dans entries.text, y compris refus. |
| `item/autoApprovalReview/started $.params.review.rationale` | 63 | 63 | Examen commencé, pas de décision finale. |
| `item/autoApprovalReview/completed $.params.review.rationale` | 63 | 0 | Décision complète; motif présent. |

Aucun chemin natif `reason`, `raison`, `explanation`, `decisionReason`, `reasonCode` ou `failure_reason` supplémentaire observé. Les motifs textuels des warnings guardian sont dans `message`.

### run-baseline

| Événement et chemin | Occurrences | Null | État/interprétation |
| --- | ---: | ---: | --- |
| `mcpServer/startupStatus/updated $.params.failureReason` | 4 | 4 | starting/ready, aucun échec. |
| `item/autoApprovalReview/started $.params.review.rationale` | 25 | 25 | Examen commencé, pas de décision finale. |
| `item/autoApprovalReview/completed $.params.review.rationale` | 25 | 0 | Décision complète; motif présent. |

Aucun chemin natif `reason`, `raison`, `explanation`, `decisionReason`, `reasonCode` ou `failure_reason` supplémentaire observé. Les motifs textuels des warnings guardian sont dans `message`.

## Familles AIDN observées dans les sorties des commandes/hooks

30 documents JSON AIDN/observers/help/readback dans les commandes, plus 9 résumés JSON des hooks. Les autres fragments JSON du produit, des briefs ou du code lu sont exclus. Les représentations Python/JavaScript en texte sont conservées dans inventory-final.json; `a.get(...) == None` ne prouve pas qu’un champ est présent avec null.

### pre-write-admit/full

Documents : 8. Lignes du trace : 61, 145, 161, 3511, 3595, 3615, 4020, 4160.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.blocking_reasons` | 8 | 0 | 6 | 0 |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 6 | 0 | 0 | 2 |
| `$.context.usage_matrix_rationale` | 6 | 0 | 0 | 2 |
| `$.context.source_of_truth_reason_codes` | 6 | 0 | 0 | 2 |
| `$.checks.source_of_truth_policy_resolved.reason_code` | 6 | 0 | 0 | 2 |
| `$.checks.source_of_truth_state_mode_alignment.reason_code` | 6 | 0 | 0 | 2 |
| `$.checks.source_of_truth_db_only_source_alignment.reason_code` | 6 | 0 | 0 | 2 |

### bootstrap-diagnostics.v1

Documents : 2. Lignes du trace : 73, 3527.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| Aucun champ de motif dans cette famille | 0 | 0 | 0 | Sans attente de motif universel |

### run-json-hook/start-session/compact

Documents : 2. Lignes du trace : 328, 3832.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.reason_codes` | 2 | 0 | 2 | 0 |
| `$.reason_code` | 2 | 2 | 0 | 0 |
| `$.blocking_reasons` | 2 | 0 | 2 | 0 |
| `$.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.db_sync.reason` | 2 | 0 | 0 | 0 |
| `$.normalized.reason_codes` | 2 | 0 | 2 | 0 |
| `$.normalized.reason_code` | 2 | 2 | 0 | 0 |
| `$.normalized.blocking_reasons` | 2 | 0 | 2 | 0 |
| `$.normalized.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.summary.reason_code` | 2 | 2 | 0 | 0 |
| `$.summary.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.daemon.reason` | 2 | 0 | 0 | 0 |

### runtime-workflow-action.v1 [help]

Documents : 2. Lignes du trace : 334, 3724.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| Aucun champ de motif dans cette famille | 0 | 0 | 0 | Sans attente de motif universel |

### db-first-artifact/error

Documents : 1. Lignes du trace : 424.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| Aucun champ de motif dans cette famille | 0 | 0 | 0 | Sans attente de motif universel |

### db-first-artifact

Documents : 1. Lignes du trace : 438.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.artifact.classification_reason` | 1 | 1 | 0 | 0 |

### project-runtime-state

Documents : 1. Lignes du trace : 438.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 1 | 0 | 0 | 0 |
| `$.digest.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.digest.repair_routing_reason` | 1 | 0 | 0 | 0 |

### run-json-hook/cycle-create/compact

Documents : 1. Lignes du trace : 516.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.reason_codes` | 1 | 0 | 1 | 0 |
| `$.reason_code` | 1 | 1 | 0 | 0 |
| `$.blocking_reasons` | 1 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.db_sync.reason` | 1 | 1 | 0 | 0 |
| `$.db_sync.payload.reason` | 1 | 0 | 0 | 0 |
| `$.db_sync.payload.fallback_full_reason` | 1 | 1 | 0 | 0 |
| `$.db_sync.payload.fast_path.reason` | 1 | 0 | 0 | 0 |
| `$.db_sync.payload.repair_layer_result.skip_reason` | 1 | 0 | 0 | 0 |
| `$.db_sync.payload.repair_layer_triage_result.skip_reason` | 1 | 0 | 0 | 0 |
| `$.normalized.reason_codes` | 1 | 0 | 1 | 0 |
| `$.normalized.reason_code` | 1 | 1 | 0 | 0 |
| `$.normalized.blocking_reasons` | 1 | 0 | 1 | 0 |
| `$.normalized.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.summary.reason_code` | 1 | 1 | 0 | 0 |
| `$.summary.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.daemon.reason` | 1 | 0 | 0 | 0 |

### run-json-hook/drift-check/compact

Documents : 1. Lignes du trace : 753.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.reason_codes` | 1 | 0 | 1 | 0 |
| `$.reason_code` | 1 | 0 | 0 | 0 |
| `$.blocking_reasons` | 1 | 0 | 1 | 0 |
| `$.repair_primary_reason` | 1 | 1 | 0 | 0 |
| `$.db_sync.reason` | 1 | 0 | 0 | 0 |
| `$.normalized.reason_codes` | 1 | 0 | 1 | 0 |
| `$.normalized.reason_code` | 1 | 0 | 0 | 0 |
| `$.normalized.blocking_reasons` | 1 | 0 | 1 | 0 |
| `$.normalized.repair_primary_reason` | 1 | 1 | 0 | 0 |
| `$.summary.reason_code` | 1 | 1 | 0 | 0 |
| `$.summary.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.daemon.reason` | 1 | 0 | 0 | 0 |

### codex-context/readback

Documents : 1. Lignes du trace : 753.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.latest.start-session.reason_codes` | 1 | 0 | 1 | 0 |
| `$.latest.start-session.reason_code` | 1 | 1 | 0 | 0 |
| `$.latest.start-session.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.latest.cycle-create.reason_codes` | 1 | 0 | 1 | 0 |
| `$.latest.cycle-create.reason_code` | 1 | 1 | 0 | 0 |
| `$.latest.cycle-create.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.latest.branch-cycle-audit.reason_codes` | 1 | 0 | 1 | 0 |
| `$.latest.branch-cycle-audit.reason_code` | 1 | 0 | 0 | 0 |
| `$.latest.branch-cycle-audit.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.latest.drift-check.reason_codes` | 1 | 0 | 1 | 0 |
| `$.latest.drift-check.reason_code` | 1 | 0 | 0 | 0 |
| `$.latest.drift-check.repair_primary_reason` | 1 | 1 | 0 | 0 |
| `$.history[].reason_codes` | 4 | 0 | 4 | 0 |
| `$.history[].reason_code` | 4 | 2 | 0 | 0 |
| `$.history[].repair_primary_reason` | 4 | 1 | 0 | 0 |

### skill-hook/drift-check

Documents : 1. Lignes du trace : 768.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 1 | 1 | 0 | 0 |
| `$.reason_code` | 1 | 0 | 0 | 0 |
| `$.payload.reason_code` | 1 | 0 | 0 | 0 |
| `$.payload.levels.level1.reason_codes` | 1 | 0 | 0 | 0 |
| `$.payload.levels.level3.reason` | 1 | 1 | 0 | 0 |
| `$.payload.summary.reason_code` | 1 | 0 | 0 | 0 |

### gating-evaluate

Documents : 1. Lignes du trace : 945.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.reason_code` | 1 | 0 | 0 | 0 |
| `$.levels.level1.reason_codes` | 1 | 0 | 0 | 0 |
| `$.levels.level3.reason` | 1 | 1 | 0 | 0 |
| `$.summary.reason_code` | 1 | 0 | 0 | 0 |

### runtime-workflow-inspect.v1 [help]

Documents : 1. Lignes du trace : 1069.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| Aucun champ de motif dans cette famille | 0 | 0 | 0 | Sans attente de motif universel |

### state-reanchor/preview

Documents : 1. Lignes du trace : 1750.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.backend.connection.driver.rationale` | 1 | 0 | 0 | 0 |
| `$.plan.reason` | 1 | 0 | 0 | 0 |
| `$.canonical_write.reason` | 1 | 0 | 1 | 0 |

### perf-hook/handoff-close

Documents : 1. Lignes du trace : 3171.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.reason_code` | 1 | 0 | 0 | 0 |
| `$.checkpoint.reload.reason_codes` | 1 | 0 | 0 | 0 |
| `$.checkpoint.gate.reason_code` | 1 | 0 | 0 | 0 |
| `$.checkpoint.gate.levels.level1.reason_codes` | 1 | 0 | 0 | 0 |
| `$.checkpoint.gate.levels.level3.reason` | 1 | 0 | 0 | 0 |
| `$.checkpoint.gate.skip_reason` | 1 | 1 | 0 | 0 |
| `$.checkpoint.index.skip_reason` | 1 | 0 | 0 | 0 |
| `$.checkpoint.index_sync_check.skip_reason` | 1 | 1 | 0 | 0 |
| `$.checkpoint.summary.reason_code` | 1 | 0 | 0 | 0 |
| `$.checkpoint.summary.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.summary.reason_code` | 1 | 0 | 0 | 0 |
| `$.summary.repair_primary_reason` | 1 | 0 | 0 | 0 |

### artifact-fetch

Documents : 1. Lignes du trace : 3880.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| Aucun champ de motif dans cette famille | 0 | 0 | 0 | Sans attente de motif universel |

### handoff-admit/full

Documents : 1. Lignes du trace : 3889.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.route.reason` | 1 | 0 | 0 | 0 |
| `$.shared_planning_gate_reason` | 1 | 0 | 0 | 0 |
| `$.shared_state_backend.runtime_backend.connection.driver.rationale` | 1 | 0 | 0 | 0 |
| `$.packet.shared_planning_gate_reason` | 1 | 0 | 0 | 0 |
| `$.packet.transition_policy_reason` | 1 | 0 | 0 | 0 |
| `$.packet.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.transition_policy.reason` | 1 | 0 | 0 | 0 |
| `$.packet_resolution.selection_reason` | 1 | 0 | 0 | 0 |

### pre-write-admit/observer-projection

Documents : 3. Lignes du trace : 4414, 4414, 4414.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.blocking_reasons` | 3 | 0 | 2 | 0 |
| `$.context.usage_matrix_rationale` | 3 | 0 | 0 | 0 |
| `$.context.source_of_truth_reason_codes` | 3 | 0 | 0 | 0 |

### native-hook/admission-summary

Documents : 9. Lignes du trace : 13, 1060, 1224, 1325, 1462, 2621, 2700, 2845, 3456.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.blocking_reasons` | 9 | 0 | 8 | 0 |
| `$.omissions.blocking_reasons` | 9 | 0 | 0 | 0 |

## Raw files persistés AIDN : inventaire complet séparé

Ces 24 fichiers couvrent start-session, cycle-create, branch-cycle-audit, drift-check, requirements-delta, cycle-close, close-session et handoff-close. Ils conservent les motifs de niveaux et d’admission même lorsque la normalisation les a perdus.

### skill-hook/branch-cycle-audit

Documents : 4.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 4 | 0 | 0 | 0 |
| `$.reason_code` | 4 | 2 | 0 | 0 |
| `$.payload.reason_code` | 4 | 2 | 0 | 0 |
| `$.payload.admission.reason_code` | 4 | 4 | 0 | 0 |
| `$.payload.admission.blocking_reasons` | 4 | 0 | 4 | 0 |
| `$.payload.gating.reason_code` | 4 | 2 | 0 | 0 |
| `$.payload.gating.levels.level1.reason_codes` | 4 | 0 | 1 | 0 |
| `$.payload.gating.levels.level3.reason` | 4 | 4 | 0 | 0 |
| `$.payload.gating.summary.reason_code` | 4 | 2 | 0 | 0 |
| `$.payload.levels.level1.reason_codes` | 4 | 0 | 1 | 0 |
| `$.payload.levels.level3.reason` | 4 | 4 | 0 | 0 |
| `$.payload.summary.reason_code` | 4 | 2 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 4 | 0 | 0 | 0 |

### skill-hook/close-session

Documents : 3.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.admission.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.admission.cycle_decisions[].rationale` | 2 | 0 | 2 | 1 |
| `$.payload.admission.blocking_reasons` | 3 | 0 | 3 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 3 | 1 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.reload.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.levels.level1.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.levels.level3.reason` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.index.skip_reason` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.index_sync_check.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.summary.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.summary.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.summary.checkpoint_reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |

### skill-hook/cycle-close

Documents : 2.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.blocking_reasons` | 2 | 0 | 2 | 0 |
| `$.payload.admission.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.admission.target_cycle.usage_matrix_rationale` | 2 | 0 | 0 | 0 |
| `$.payload.admission.validation_summary.usage_matrix_rationale` | 2 | 0 | 0 | 0 |
| `$.payload.admission.blocking_reasons` | 2 | 0 | 2 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 2 | 0 | 0 | 0 |

### skill-hook/cycle-create

Documents : 2.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.admission.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.admission.blocking_reasons` | 2 | 0 | 2 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 2 | 2 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 2 | 0 | 0 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 2 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 2 | 2 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 2 | 0 | 0 | 0 |

### gating-evaluate

Documents : 4.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.reason_code` | 4 | 2 | 0 | 0 |
| `$.levels.level1.reason_codes` | 4 | 0 | 1 | 0 |
| `$.levels.level3.reason` | 4 | 4 | 0 | 0 |
| `$.summary.reason_code` | 4 | 2 | 0 | 0 |

### skill-hook/drift-check

Documents : 2.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 2 | 2 | 0 | 0 |
| `$.reason_code` | 2 | 1 | 0 | 0 |
| `$.payload.reason_code` | 2 | 1 | 0 | 0 |
| `$.payload.levels.level1.reason_codes` | 2 | 0 | 0 | 0 |
| `$.payload.levels.level3.reason` | 2 | 2 | 0 | 0 |
| `$.payload.summary.reason_code` | 2 | 1 | 0 | 0 |

### skill-hook/handoff-close

Documents : 3.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.reason_code` | 3 | 2 | 0 | 0 |
| `$.payload.reason_code` | 3 | 2 | 0 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 3 | 2 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 3 | 2 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 3 | 2 | 0 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 3 | 2 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |

### skill-hook/requirements-delta

Documents : 1.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.reason_code` | 1 | 1 | 0 | 0 |
| `$.payload.reason_code` | 1 | 1 | 0 | 0 |
| `$.payload.admission.reason_code` | 1 | 1 | 0 | 0 |
| `$.payload.admission.blocking_reasons` | 1 | 0 | 1 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 1 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 1 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 1 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 1 | 1 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 1 | 1 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 1 | 0 | 0 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 1 | 1 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 1 | 0 | 0 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 1 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 1 | 1 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 1 | 0 | 0 | 0 |

### skill-hook/start-session

Documents : 3.

| Chemin | Occurrences | Null | Vide | Documents sans ce chemin |
| --- | ---: | ---: | ---: | ---: |
| `$.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.admission.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.admission.blocking_reasons` | 3 | 0 | 3 | 0 |
| `$.payload.checkpoint.reload.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level1.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.gate.levels.level3.reason` | 3 | 2 | 0 | 0 |
| `$.payload.checkpoint.gate.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.checkpoint.index.skip_reason` | 3 | 0 | 0 | 0 |
| `$.payload.checkpoint.index_sync_check.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.checkpoint.summary.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.checkpoint.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.reload.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.levels.level1.reason_codes` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.levels.level3.reason` | 3 | 2 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.gate.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.index.skip_reason` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.index_sync_check.skip_reason` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.summary.reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.checkpoint.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.workflow_hook.summary.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.workflow_hook.summary.checkpoint_reason_code` | 3 | 1 | 0 | 0 |
| `$.payload.workflow_hook.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
| `$.payload.summary.reason_code` | 3 | 3 | 0 | 0 |
| `$.payload.summary.repair_primary_reason` | 3 | 0 | 0 | 0 |
