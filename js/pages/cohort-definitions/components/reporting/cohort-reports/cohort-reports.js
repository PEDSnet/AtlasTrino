define([
	'knockout',
	'const',
	'components/Component',
	'services/PluginRegistry',
	'./const',
	'utils/CommonUtils',
	'text!./cohort-reports.html',
	'components/tabs',
	'./inclusion-report',
	'./observation-report'
], function (
	ko,
	globalConstants,
	Component,
	PluginRegistry,
	constants,
	commonUtils,
	view,
	observationReport
) {

	console.log('🔧 cohort-reports.js: Module loading, about to register plugins');
	
	PluginRegistry.add(globalConstants.pluginTypes.COHORT_REPORT, {
		title: ko.i18n('cohortDefinitions.cohortreports.inclusionReport', 'Inclusion Report'),
		priority: 1,
		html: `<cohort-report-inclusion params="{ sourceKey: sourceKey, cohortId: cohortId, isViewDemographic: isViewDemographic, ccGenerateId: ccGenerateId }"></cohort-report-inclusion>`
	});

    // -----------------------------------------------------------------
    // Observation Report – register the component.
    // The tabs component (used by CohortReports) can render a report in two ways:
    //   1) via an `html` template string, or
    //   2) via a `componentName`/`component` property.
    // Older versions of Atlas only handled the `html` case for cohort reports.
    // Providing both guarantees that the tab will be instantiated.
    // -----------------------------------------------------------------
	// Restore HTML fallback while also providing componentName/component for proper tab creation
	PluginRegistry.add(globalConstants.pluginTypes.COHORT_REPORT, {
		title: ko.i18n('cohortDefinitions.cohortreports.observationReport', 'Observation Report'),
		priority: 2,
        componentName: 'observation-report',
		component: 'observation-report',
		html: `<observation-report params="{ sourceKey: sourceKey, cohortId: cohortId, isViewDemographic: isViewDemographic, ccGenerateId: ccGenerateId }"></observation-report>`
	});

	class CohortReports extends Component {
		constructor(params) {
			super();

			this.sourceKey = ko.computed(() => params.source() && params.source().sourceKey);
			this.cohortId = ko.computed(() => params.cohort().id());
			this.isViewDemographic = ko.computed(() => params.source() && params.source().viewDemographic());
			// `infoSelected` is optional – the manager sometimes calls this component
			// without providing it (e.g., when the Reporting pane is opened from a
			// Cohort Definition without a selected execution). Guard against a missing
			// function to avoid "params.infoSelected is not a function" errors.
			this.ccGenerateId = ko.computed(() => {
				return params.infoSelected && typeof params.infoSelected === 'function'
					? params.infoSelected().ccGenerateId()
					: null;
			});
			const componentParams =  {
				sourceKey: this.sourceKey,
				cohortId: this.cohortId,
				isViewDemographic: this.isViewDemographic,
				ccGenerateId: this.ccGenerateId,
			};

			const pluginTabs = PluginRegistry.findByType(globalConstants.pluginTypes.COHORT_REPORT);
			console.log('📊 CohortReports constructor: Found', pluginTabs.length, 'plugin tabs:', pluginTabs.map(t => ({ title: t.title, componentName: t.componentName, hasHtml: !!t.html })));
			this.tabs = pluginTabs.map(t => {
				return { ...t, componentParams };
			});
			
			if (this.isViewDemographic()) {
				this.tabs.push({
					title: ko.i18n('cohortDefinitions.cohortreports.tabs.byPerson3', 'Demographics'),
					componentName: 'demographic-report',
					componentParams: {
						...componentParams,
						reportType: constants.INCLUSION_REPORT.BY_DEMOGRAPHIC,
						buttons: null,
						tableDom: "Blfiprt"
					}
				});
			}		
		}

		dispose() {
			this.sourceKey.dispose();
			this.cohortId.dispose();
			this.isViewDemographic.dispose();
			this.ccGenerateId.dispose();
		}
	}

	return commonUtils.build('cohort-reports', CohortReports, view);
});
