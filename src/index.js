const core = require('@actions/core');
const github = require('@actions/github');
const { POTComparator } = require('./comparator');
const { Reporter } = require('./reporter');
const { LLMMatcher } = require('./llm-matcher');
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
    const openrouterKey = core.getInput('openrouter-key');
    const openrouterModel = core.getInput('openrouter-model') || 'anthropic/claude-3.5-sonnet';

    console.log('🌍 i18n String Reviewer');
    console.log('========================');
    console.log(`Base POT file: ${basePotFile}`);
    console.log(`Target POT file: ${targetPotFile}`);
    if (openrouterKey) {
      console.log(`LLM Matching: Enabled (${openrouterModel})`);
    }
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

    // Initialize GitHub context for PR operations (commenting and caching)
    let octokit = null;
    let prContext = null;
    
    if (githubToken && github.context.eventName === 'pull_request') {
      octokit = github.getOctokit(githubToken);
      const { owner, repo } = github.context.repo;
      const pullRequestNumber = github.context.payload.pull_request?.number;
      
      if (pullRequestNumber) {
        prContext = { owner, repo, pullRequestNumber };
        
        // Initialize LLM cache with PR context if LLM is enabled
        if (openrouterKey) {
          await LLMMatcher.initCache('.llm-cache.json', octokit, prContext);
        }
      }
    }

    // Generate reports
    const jsonReport = Reporter.generateJSONReport(results);
    const markdownReport = await Reporter.generateMarkdownReport(
      results,
      comparator.baseEntries,
      openrouterKey,
      openrouterModel
    );

    // Set outputs
    core.setOutput('added-count', results.addedCount);
    core.setOutput('removed-count', results.removedCount);
    core.setOutput('changed-count', results.changedCount);
    core.setOutput('total-changes', results.totalChanges);
    core.setOutput('report', markdownReport || '');

    // Display report in logs (only if there are changes)
    if (markdownReport) {
      console.log('\n' + markdownReport);
    }

    // Add to job summary (only in GitHub Actions environment and if there are changes)
    if (process.env.GITHUB_STEP_SUMMARY && markdownReport) {
      await core.summary
        .addRaw(markdownReport)
        .write();
    }

    // Comment on PR if requested
    if (commentOnPR && octokit && prContext) {
      try {
        const { owner, repo, pullRequestNumber } = prContext;
        
        if (pullRequestNumber) {
          // Add a unique identifier to find this comment later
          const commentIdentifier = '<!-- i18n-string-reviewer-report -->';

          // Find existing comment from this action
          const { data: comments } = await octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: pullRequestNumber,
          });

          const existingComment = comments.find(comment => 
            comment.body?.includes(commentIdentifier)
          );

          if (results.totalChanges > 0) {
            // There are changes - post or update comment
            const commentBody = `${commentIdentifier}\n${markdownReport}`;

            if (existingComment) {
              // Update existing comment
              await octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: existingComment.id,
                body: commentBody
              });
              console.log('\n✓ Updated existing PR comment');
            } else {
              // Create new comment
              await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pullRequestNumber,
                body: commentBody
              });
              console.log('\n✓ Posted new comment to PR');
            }
          } else {
            // No changes - delete existing comment if it exists
            if (existingComment) {
              await octokit.rest.issues.deleteComment({
                owner,
                repo,
                comment_id: existingComment.id
              });
              console.log('\n✓ Deleted existing PR comment (no changes detected)');
            }
          }
        }
      } catch (error) {
        core.warning(`Failed to comment on PR: ${error.message}`);
      }
    }

    // Save LLM cache if it was used
    if (openrouterKey) {
      await LLMMatcher.saveCache();
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

