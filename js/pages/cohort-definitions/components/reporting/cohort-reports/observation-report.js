define([
    'knockout',
    'jquery',
    'services/CohortDefinition',
    'pages/characterizations/services/conversion/PrevalenceStatConverter',
    'pages/characterizations/services/conversion/DistributionStatConverter',
    'pages/characterizations/services/conversion/ComparativeDistributionStatConverter',
    'pages/characterizations/utils',
    'text!./observation-report.html',
    'appConfig',
    'services/AuthAPI',
    'components/Component',
    'utils/AutoBind',
    'utils/CommonUtils',
    'numeral',
    'lodash',
    'd3',
    'components/visualizations/filter-panel/utils',
    'components/conceptset/ConceptSetStore',
    'services/MomentAPI',
    'services/Source',
    'utils/CsvUtils',
    'services/Vocabulary',
    'atlas-state',
    'utils/ExceptionUtils',
    'services/file',
    'less!./observation-report.less',
    'components/visualizations/filter-panel/filter-panel',
    'components/visualizations/line-chart',
    'components/charts/scatterplot',
    'components/charts/splitBoxplot',
    'components/charts/horizontalBoxplot',
    'd3-scale-chromatic',
], function (
    ko,
    $,
    CohortDefinitionService,
    PrevalenceStatConverter,
    DistributionStatConverter,
    ComparativeDistributionStatConverter,
    pageUtils,
    view,
    config,
    authApi,
    Component,
    AutoBind,
    commonUtils,
    utils,
    numeral,
    lodash,
    d3,
    filterUtils,
    ConceptSetStore,
    momentAPI,
    SourceService,
    CsvUtils,
    vocabularyProvider,
    sharedState,
    exceptionUtils,
    FileService
) {

    const TYPE_PREVALENCE = 'prevalence';

    class ObservationReportView extends AutoBind(Component) {

        constructor(params) {
            super();
            console.log('📝 Observation Report Component: Constructor called with params:', params);
            console.log('📝 Observation Report: sourceKey:', params.sourceKey?.());
            console.log('📝 Observation Report: cohortId:', params.cohortId?.());
            
            this.reportType = params.reportType;
            this.cohortId = params.cohortId;
            this.ccGenerateId = params.ccGenerateId;
            this.prevalenceStatConverter = new PrevalenceStatConverter(this.classes);
            this.distributionStatConverter = new DistributionStatConverter(this.classes);
            this.comparativeDistributionStatConverter = new ComparativeDistributionStatConverter(this.classes);
            this.conceptSetStore = ConceptSetStore.characterization();
            this.currentConceptSet = ko.pureComputed(() => this.conceptSetStore.current());
            this.loading = ko.observable(false);

            this.design = ko.observable({});
            this.executionId = ko.observable();
            this.loadedExecutionId = null;
            this.data = ko.observable([]);
            this.domains = ko.observableArray();
            this.filterList = ko.observableArray([]);
            this.selectedItems = ko.pureComputed(() => filterUtils.getSelectedFilterValues(this.filterList()));
            this.selectedItems.subscribe(() => this.updateData);
            this.analysisList = ko.observableArray([]);
            this.canExportAll = ko.pureComputed(() => this.data().analyses && this.data().analyses.length > 0);
            this.source = ko.pureComputed(() => {
                return sharedState.sources().find(s => s.sourceKey === params.sourceKey());
            });
            this.stratifiedByTitle = ko.pureComputed(() => this.design().stratifiedBy || '');

            this.groupedScatterColorScheme = d3.schemeCategory10;
            this.scatterXScale = d3.scaleLinear().domain([0, 100]);
            this.scatterYScale = d3.scaleLinear().domain([0, 100]);

            this.executionDesign = ko.observable();
            this.isExecutionDesignShown = ko.observable();
            this.showEmptyResults = ko.observable();
            this.totalResultsCount = ko.observable();
            this.resultsCountFiltered = ko.observable();
            this.downloading = ko.observableArray();
            this.tableOptions = commonUtils.getTableOptions('M');
            this.datatableLanguage = ko.i18n('datatable.language');

            // Subscribe to source changes to reload data when source is available
            this.source.subscribe(() => {
                if (this.source() && this.cohortId()) {
                    this.loadData();
                }
            });

            // Initial load if source is available
            if (this.source() && this.cohortId()) {
                this.loadData();
            }
        }

        isResultDownloading(analysisName) {
            return ko.computed(() => this.downloading().indexOf(analysisName) >= 0);
        }

        formatDate(date) {
            return momentAPI.formatDateTimeUTC(date);
        }

        showExecutionDesign() {
            this.executionDesign(null);
            this.isExecutionDesignShown(true);
            CohortDefinitionService
                .loadExportDesignByGeneration(this.executionId())
                .then(res => {
                    this.executionDesign(res);
                    this.loading(false);
                });
        }

        async loadData() {
            this.loading(true);
            
            console.log('🔍 Observation Report: loadData() called');
            console.log('  sourceKey:', this.source()?.sourceKey);
            console.log('  cohortId:', this.cohortId());

            const url = config.api.url + 'cohortresults/' + this.source().sourceKey + '/' + this.cohortId() + '/observation?refresh=true';
            console.log('  URL:', url);

            $.ajax({
                url: url,
                type: 'GET',
                contentType: 'application/json',
                error: (error) => {
                    console.error("🚨 Observation Report Error:", error);
                    authApi.handleAccessDenied(error);
                    this.loading(false);
                }
            }).done((generationResults) => {
                console.log('✅ Observation Report Data Received:', generationResults);
                const count = generationResults?.observationStats?.length ? (generationResults.observationStats.reduce((prev, curr) => [...prev, ...curr.items], []) || []).length : 0;
                this.showEmptyResults(generationResults.showEmptyResults || null);
                this.resultsCountFiltered(generationResults.count || count);
                this.getData(generationResults?.observationStats);
                this.loading(false);
            });
        }

        getData(resultsList) {
            const result = {
                ...this.data(),
                sourceId: this.source().sourceId,
                sourceKey: this.source().sourceKey,
                sourceName: this.source().sourceName,
                analyses: lodash.sortBy(
                    lodash.uniqBy(
                        resultsList?.map(r => ({
                            analysisId: r.analysisId,
                            domainId: this.design() && this.design().featureAnalyses && !r.isSummary ?
                                (this.design().featureAnalyses.find(fa => fa.id === r.id) || {})['domain'] : null,
                            rawAnalysisName: r.analysisName,
                            analysisName: r.analysisName,
                            cohorts: r.cohorts,
                            domainIds: r.domainIds,
                            type: r.resultType.toLowerCase(),
                            isSummary: r.isSummary,
                            isComparative: r.isComparative,
                            items: r.items,
                        })),
                        'analysisId'
                    ),
                    [(a) => { return a.analysisId || '' }], ['desc']
                ),
            }
            this.data(result);
            this.prepareTabularData();
        }

        sortedStrataNames(strataNames) {
            return utils.sortedStrataNames(strataNames, true);
        }

        prepareTabularData() {
            if (!this.data().analyses || this.data().analyses.length === 0) {
                this.analysisList([]);
                return;
            }

            const designStratas = this.showEmptyResults() ? this.design().stratas.map(s => ({ strataId: s.id, strataName: s.name })) : null;

            const convertedData = this.data().analyses.map(analysis => {
                let converter;
                if (analysis.type === TYPE_PREVALENCE) {
                    converter = this.prevalenceStatConverter;
                } else {
                    if (analysis.isComparative) {
                        converter = this.comparativeDistributionStatConverter;
                    } else {
                        converter = this.distributionStatConverter;
                    }
                }
                return converter.convertAnalysisToTabularData(analysis, designStratas);
            });
            this.analysisList(convertedData);
        }

        tooltipBuilder(d) {
            return `
                <div>${ko.i18n('cc.viewEdit.results.series', 'Series')()}: ${d.seriesName}</div>
                <div>${ko.i18n('cc.viewEdit.results.covariate', 'Covariate')()}: ${d.covariateName}</div>
                <div>X: ${d3.format('.2f')(d.xValue)}%</div>
                <div>Y: ${d3.format('.2f')(d.yValue)}%</div>
            `;
        }

        convertScatterplotData(analysis) {
            const seriesData = lodash.groupBy(analysis.data, 'analysisName');
            const firstCohortId = analysis.cohorts[0].cohortId;
            const secondCohortId = analysis.cohorts[1].cohortId;
            return Object.keys(seriesData).map(key => ({
                name: key,
                values: seriesData[key].filter(rd => rd.pct[0][firstCohortId] && rd.pct[0][secondCohortId]).map(rd => ({
                    covariateName: rd.covariateName,
                    xValue: rd.pct[0][firstCohortId] || 0,
                    yValue: rd.pct[0][secondCohortId] || 0
                })),
            }));
        }

        getBoxplotStruct(cohort, stat) {
            return {
                Category: cohort.cohortName,
                min: stat.min[0][cohort.cohortId],
                max: stat.max[0][cohort.cohortId],
                median: stat.median[0][cohort.cohortId],
                LIF: stat.p10[0][cohort.cohortId],
                q1: stat.p25[0][cohort.cohortId],
                q3: stat.p75[0][cohort.cohortId],
                UIF: stat.p90[0][cohort.cohortId]
            };
        }

        convertBoxplotData(analysis) {
            return [{
                target: this.getBoxplotStruct(analysis.cohorts[0], analysis.data[0]),
                compare: this.getBoxplotStruct(analysis.cohorts[1], analysis.data[0]),
            }];
        }

        convertHorizontalBoxplotData(analysis) {
            return analysis.cohorts.map(cohort => {
                return this.getBoxplotStruct(cohort, analysis.data[0]);
            });
        }

        prepareLegendBoxplotData(analysis) {
            const cohortNames = analysis.cohorts.map(d => d.cohortName);
            const legendColorsSchema = d3.scaleOrdinal().domain(cohortNames)
                .range(utils.colorHorizontalBoxplot);

            const legendColors = cohortNames.map(cohort => {
                return {
                    cohortName: cohort,
                    cohortColor: legendColorsSchema(cohort)
                };
            });
            return legendColors.reverse();
        }

        analysisTitle(data) {
            const strata = data.stratified ? (' / stratified by ' + this.stratifiedByTitle()) : '';
            return (data.domainId ? (data.domainId + ' / ') : '') + data.analysisName + strata;
        }
    }

    return commonUtils.build('observation-report', ObservationReportView, view);
});
