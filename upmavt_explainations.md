## Below the title "Run UP-MAVT"
Uncertainty Propagated - Multi-Attribute Value Theory (UP-MAVT) is an extension of traditional MAVT developed by S.P. (see PLACEHOLDER). 

This method uses Monte Carlo simulations to propagate uncertainties arising from any component of the analysis. This diagram illustrates the sources of uncertainty considered in the framework. (this sentence links to image Uncertainties.pdf)

The workflow is designed to examine all aspects of the framework, including consensus among multiple opinions, dominance patterns, compensatory dynamics for selecting the aggregation model, overall uncertainty assessment, and the final results. The UP-MAVT code implements two Monte Carlo approaches—"strict" and "non-strict", each serving a distinct purpose. The logic behind these methods is detailed in this image (this links to image MC_modes.pdf).

THIS GOES IN BOLD:
For a comprehensive explanation, an overview of the workflow, and an example case study, please refer to the publication PLACEHOLDER.

## In the workflows

### step 1
Compute weights
The PILE-BWT method computes weights by solving an optimization problem, as described in RIVER-PLACEHOLDER. The process begins with a local solver based on COBYQA (SCIPY-COBYQA-PLACEHOLDER) to obtain an initial valid solution. Following this, the Differential Evolution algorithm (SCIPY-DE-PLACEHOLDER) is applied to explore the full range of possible weights, thereby defining the weight space.

Due to the complexity of the search, this process may take some time. For example, with 15 criteria organized into 4 groups, the computation typically requires between 10 and 15 minutes. Your patience is appreciated.

### step 2
The output of the SMC can be used to assess the consensus or agreement among experts. If the distributions largely overlap, consensus can be considered reached. Otherwise, it is important to reflect on the implications of aggregating divergent opinions.

### step 3
Dominance patterns can be observed in the NSMC heatmaps when using random weights. If an alternative consistently dominates others regardless of the weights assigned to its criteria, this should prompt reflection: while it is possible that the alternative is genuinely superior across all preferences, such behavior may also suggest a bias in the indicator definitions.

### step 4
The code offers a choice of three aggregation methods: SUM (weighted sum), which is fully compensatory, and GEO (geometric mean) and HAR (harmonic mean), which are partially compensatory. By comparing the differences in the NSMC heatmaps, the practitioner can determine which aggregation method is most appropriate for their study.

### step 5
By running the SMC with the preferred aggregation method, the practitioner can assess the overall uncertainty of the resulting distributions. This step can reveal insights that might otherwise be obscured by the final aggregated results.

### step 6
The final results are generated using NSMC with the practitioner’s chosen aggregation method.