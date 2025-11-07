const core = require('@actions/core');
const github = require('@actions/github');
const { POTComparator } = require('./comparator');
const { Reporter } = require('./reporter');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    // Get inputs
    const basePotFile = core.getInput('base-pot-file', { required: true });
    const targetPotFile = core.getInput('target-pot-file', { required: true });
    const failOnChanges = core.getInput('fail-on-changes') === 'true';
    const githubToken = core.getInput('github-token');
    const commentOnPR = core.getInput('comment-on-pr') === 'true';

    console.log('🌍 i18n String Reviewer');
    console.log('========================');
    console.log(`Base POT file: ${basePotFile}`);
    console.log(`Target POT file: ${targetPotFile}`);
    console.log('');

    // Validate files exist
    if (!fs.existsSync(basePotFile)) {
      core.setFailed(`Base POT file not found: ${basePotFile}`);
      return;
    }

    if (!fs.existsSync(targetPotFile)) {
      core.setFailed(`Target POT file not found: ${targetPotFile}`);
      return;
    }

    // Create comparator and run comparison
    const comparator = new POTComparator(basePotFile, targetPotFile);
    comparator.loadPOTFiles();
    comparator.compare();

    // Get results
    const results = comparator.getResults();

    // Generate reports
    const jsonReport = Reporter.generateJSONReport(results);
    const markdownReport = Reporter.generateMarkdownReport(results);

    // Set outputs
    core.setOutput('added-count', results.addedCount);
    core.setOutput('removed-count', results.removedCount);
    core.setOutput('changed-count', results.changedCount);
    core.setOutput('total-changes', results.totalChanges);
    core.setOutput('report', markdownReport);

    // Display report in logs
    console.log('\n' + markdownReport);

    // Add to job summary (only in GitHub Actions environment)
    if (process.env.GITHUB_STEP_SUMMARY) {
      await core.summary
        .addRaw(markdownReport)
        .write();
    }

    // Comment on PR if requested
    if (commentOnPR && githubToken && github.context.eventName === 'pull_request') {
      try {
        const octokit = github.getOctokit(githubToken);
        const { owner, repo } = github.context.repo;
        const pullRequestNumber = github.context.payload.pull_request?.number;

        if (pullRequestNumber && results.totalChanges > 0) {
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullRequestNumber,
            body: markdownReport
          });
          console.log('\n✓ Posted comment to PR');
        } else if (results.totalChanges === 0) {
          console.log('\n✓ No changes detected, skipping PR comment');
        }
      } catch (error) {
        core.warning(`Failed to comment on PR: ${error.message}`);
      }
    }

    // Fail if requested and changes detected
    if (failOnChanges && results.totalChanges > 0) {
      core.setFailed(`Changes detected in POT file (${results.totalChanges} total changes). Failing as requested.`);
      return;
    }

    // Success
    if (results.totalChanges === 0) {
      console.log('\n✅ No changes detected');
    } else {
      console.log(`\n⚠️  ${results.totalChanges} change(s) detected`);
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    console.error(error);
  }
}

run();

