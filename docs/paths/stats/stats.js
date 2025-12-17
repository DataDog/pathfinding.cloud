// Stats page JavaScript
let allPaths = [];
let toolMetadata = {};

// Color schemes for charts
const categoryColors = {
    'self-escalation': '#9d4edd',
    'principal-access': '#7b2cbf',
    'new-passrole': '#5a189a',
    'existing-passrole': '#3c096c',
    'credential-access': '#10002b'
};

const chartColors = [
    '#9d4edd', '#7b2cbf', '#5a189a', '#3c096c', '#240046',
    '#c77dff', '#e0aaff', '#10002b', '#240046', '#3c096c',
    '#5a189a', '#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff'
];

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-theme');
    }
    updateThemeText();
}

function toggleTheme() {
    document.documentElement.classList.toggle('light-theme');
    const currentTheme = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
    localStorage.setItem('theme', currentTheme);
    updateThemeText();

    // Reload charts with new theme
    if (allPaths.length > 0) {
        createVisualizations();
    }
}

function updateThemeText() {
    const themeText = document.querySelector('.theme-text');
    if (themeText) {
        const isLight = document.documentElement.classList.contains('light-theme');
        themeText.textContent = isLight ? 'Mode' : 'Mode';
    }
}

// Get text color based on theme
function getTextColor() {
    return document.documentElement.classList.contains('light-theme') ? '#1a1a2e' : '#e0e0e0';
}

// Get grid color based on theme
function getGridColor() {
    return document.documentElement.classList.contains('light-theme') ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    loadData();
});

// Load data from JSON files
async function loadData() {
    try {
        const [pathsResponse, metadataResponse] = await Promise.all([
            fetch('/paths.json'),
            fetch('/metadata.json')
        ]);

        allPaths = await pathsResponse.json();
        toolMetadata = await metadataResponse.json();

        processData();
        createVisualizations();

        document.getElementById('loading').style.display = 'none';
        document.getElementById('stats-content').style.display = 'block';
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('loading').textContent = 'Error loading data. Please try again.';
    }
}

// Process data and calculate statistics
function processData() {
    const totalPaths = allPaths.length;

    // Count services
    const services = new Set();
    allPaths.forEach(path => {
        if (path.services) {
            path.services.forEach(service => services.add(service));
        }
    });

    // Calculate detection coverage
    const pathsWithDetection = allPaths.filter(path =>
        path.detectionTools && Object.keys(path.detectionTools).length > 0
    ).length;
    const detectionPercentage = Math.round((pathsWithDetection / totalPaths) * 100);

    // Count primary paths vs variants
    const primaryPaths = allPaths.filter(path => !path.parent).length;
    const variantPaths = allPaths.filter(path => path.parent).length;

    // Update summary cards
    document.getElementById('total-paths').textContent = totalPaths;
    document.getElementById('total-services').textContent = services.size;
    document.getElementById('detection-coverage').textContent = `${detectionPercentage}%`;
    document.getElementById('primary-paths').textContent = primaryPaths;
    document.getElementById('variant-paths').textContent = variantPaths;
}

// Create all visualizations
function createVisualizations() {
    createServiceTreemap();
    createCategoryChart();
    createDetectionCoverageRing();
    createDetectionToolsChart();
    createRelationshipDisplay();
    initRelationshipViews();
}

// OPTION 1: Vertical Bar Chart (Original)
function createServiceChartOption1() {
    const canvas = document.getElementById('service-chart-option1');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    // Count paths per service
    // Exclude new-passrole paths from IAM count
    const serviceCounts = {};
    allPaths.forEach(path => {
        if (path.services) {
            path.services.forEach(service => {
                // Skip counting IAM for new-passrole paths
                if (service === 'iam' && path.category === 'new-passrole') {
                    return;
                }
                serviceCounts[service] = (serviceCounts[service] || 0) + 1;
            });
        }
    });

    // Sort by count descending
    const sortedServices = Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1]);

    const labels = sortedServices.map(([service]) => service.toUpperCase());
    const data = sortedServices.map(([_, count]) => count);

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Paths',
                data: data,
                backgroundColor: chartColors.slice(0, labels.length),
                borderColor: chartColors.slice(0, labels.length),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        color: getTextColor()
                    },
                    grid: {
                        color: getGridColor()
                    }
                },
                x: {
                    ticks: {
                        color: getTextColor()
                    },
                    grid: {
                        color: getGridColor()
                    }
                }
            }
        }
    });
}

// OPTION 2: Horizontal Bar Chart (Like Detection Tools)
function createServiceChartOption2() {
    const canvas = document.getElementById('service-chart-option2');
    const ctx = canvas.getContext('2d');

    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const serviceCounts = {};
    allPaths.forEach(path => {
        if (path.services) {
            path.services.forEach(service => {
                if (service === 'iam' && path.category === 'new-passrole') {
                    return;
                }
                serviceCounts[service] = (serviceCounts[service] || 0) + 1;
            });
        }
    });

    const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
    const labels = sortedServices.map(([service]) => service.toUpperCase());
    const data = sortedServices.map(([_, count]) => count);

    const gradients = labels.map((label, index) => {
        const gradient = ctx.createLinearGradient(0, 0, 400, 0);
        const baseColor = chartColors[index % chartColors.length];
        gradient.addColorStop(0, baseColor);
        gradient.addColorStop(1, baseColor + 'CC');
        return gradient;
    });

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: gradients,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: getTextColor() },
                    grid: { color: getGridColor() }
                },
                y: {
                    ticks: { color: getTextColor() },
                    grid: { display: false }
                }
            }
        },
        plugins: [{
            id: 'serviceLabels',
            afterDatasetsDraw: function(chart) {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const label = chart.data.labels[index];
                        const value = dataset.data[index];
                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 14px sans-serif';
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`${label} (${value})`, bar.x - 10, bar.y);
                    });
                });
            }
        }]
    });
}

// OPTION 3: Doughnut Chart
function createServiceChartOption3() {
    const canvas = document.getElementById('service-chart-option3');
    const ctx = canvas.getContext('2d');

    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const serviceCounts = {};
    allPaths.forEach(path => {
        if (path.services) {
            path.services.forEach(service => {
                if (service === 'iam' && path.category === 'new-passrole') {
                    return;
                }
                serviceCounts[service] = (serviceCounts[service] || 0) + 1;
            });
        }
    });

    const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
    const labels = sortedServices.map(([service]) => service.toUpperCase());
    const data = sortedServices.map(([_, count]) => count);

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: chartColors.slice(0, labels.length),
                borderColor: getTextColor(),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: getTextColor(),
                        padding: 10,
                        font: { size: 11 }
                    }
                }
            }
        }
    });
}

// OPTION 4: Bubble Chart with Circle Packing
function createServiceChartOption4() {
    const canvas = document.getElementById('service-chart-option4');
    const ctx = canvas.getContext('2d');

    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const serviceCounts = {};
    allPaths.forEach(path => {
        if (path.services) {
            path.services.forEach(service => {
                if (service === 'iam' && path.category === 'new-passrole') {
                    return;
                }
                serviceCounts[service] = (serviceCounts[service] || 0) + 1;
            });
        }
    });

    const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);

    // Create bubbles with much larger sizes and random starting positions
    const bubbles = sortedServices.map(([service, count], index) => {
        const angle = (index / sortedServices.length) * Math.PI * 2;
        const radius = 20 + Math.random() * 10;
        return {
            x: 50 + Math.cos(angle) * radius,
            y: 50 + Math.sin(angle) * radius,
            r: Math.sqrt(count) * 16, // Even larger bubbles (was 12)
            label: service.toUpperCase(),
            count: count
        };
    });

    // Two-phase circle packing: aggressive separation, then gentle clustering
    function packBubbles() {
        const centerX = 50;
        const centerY = 50;
        const padding = 2; // Minimal padding for tight packing

        // PHASE 1: Aggressive separation - eliminate ALL overlaps
        for (let iter = 0; iter < 500; iter++) {
            for (let i = 0; i < bubbles.length; i++) {
                for (let j = i + 1; j < bubbles.length; j++) {
                    const dx = bubbles[j].x - bubbles[i].x;
                    const dy = bubbles[j].y - bubbles[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = bubbles[i].r + bubbles[j].r + padding;

                    if (dist < minDist) {
                        // Very strong repulsion to completely eliminate overlaps
                        const overlap = minDist - dist;
                        const force = overlap * 0.8;
                        const angle = Math.atan2(dy, dx);
                        const fx = Math.cos(angle) * force;
                        const fy = Math.sin(angle) * force;

                        bubbles[i].x -= fx;
                        bubbles[i].y -= fy;
                        bubbles[j].x += fx;
                        bubbles[j].y += fy;
                    }
                }
            }
        }

        // PHASE 2: Gentle clustering - pull toward center without creating overlaps
        for (let iter = 0; iter < 200; iter++) {
            // First pull toward center
            bubbles.forEach(bubble => {
                const dx = centerX - bubble.x;
                const dy = centerY - bubble.y;
                bubble.x += dx * 0.005;
                bubble.y += dy * 0.005;
            });

            // Then fix any overlaps created by clustering
            for (let i = 0; i < bubbles.length; i++) {
                for (let j = i + 1; j < bubbles.length; j++) {
                    const dx = bubbles[j].x - bubbles[i].x;
                    const dy = bubbles[j].y - bubbles[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = bubbles[i].r + bubbles[j].r + padding;

                    if (dist < minDist) {
                        const overlap = minDist - dist;
                        const force = overlap * 0.8;
                        const angle = Math.atan2(dy, dx);
                        const fx = Math.cos(angle) * force;
                        const fy = Math.sin(angle) * force;

                        bubbles[i].x -= fx;
                        bubbles[i].y -= fy;
                        bubbles[j].x += fx;
                        bubbles[j].y += fy;
                    }
                }
            }
        }

        // FINAL PASS: One more aggressive separation to guarantee zero overlaps
        for (let iter = 0; iter < 100; iter++) {
            for (let i = 0; i < bubbles.length; i++) {
                for (let j = i + 1; j < bubbles.length; j++) {
                    const dx = bubbles[j].x - bubbles[i].x;
                    const dy = bubbles[j].y - bubbles[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = bubbles[i].r + bubbles[j].r + padding;

                    if (dist < minDist) {
                        const overlap = minDist - dist;
                        const force = overlap;
                        const angle = Math.atan2(dy, dx);
                        const fx = Math.cos(angle) * force;
                        const fy = Math.sin(angle) * force;

                        bubbles[i].x -= fx;
                        bubbles[i].y -= fy;
                        bubbles[j].x += fx;
                        bubbles[j].y += fy;
                    }
                }
            }
        }

        // Ensure bubbles stay within bounds with their radius considered
        bubbles.forEach(bubble => {
            const margin = bubble.r + 2;
            bubble.x = Math.max(margin, Math.min(100 - margin, bubble.x));
            bubble.y = Math.max(margin, Math.min(100 - margin, bubble.y));
        });
    }

    packBubbles();

    canvas.chart = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                data: bubbles,
                backgroundColor: chartColors.slice(0, bubbles.length).map(c => c + '99'),
                borderColor: chartColors.slice(0, bubbles.length),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.raw.label}: ${context.raw.count} paths`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: false,
                    min: 0,
                    max: 100
                },
                y: {
                    display: false,
                    min: 0,
                    max: 100
                }
            }
        },
        plugins: [{
            id: 'bubbleLabels',
            afterDatasetsDraw: function(chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0);
                meta.data.forEach((bubble, index) => {
                    const data = bubbles[index];
                    ctx.fillStyle = getTextColor();
                    ctx.font = 'bold 14px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(data.label, bubble.x, bubble.y - bubble.options.radius - 12);
                    ctx.fillText(data.count, bubble.x, bubble.y);
                });
            }
        }]
    });
}

// Service Treemap
function createServiceTreemap() {
    try {
        const canvas = document.getElementById('service-chart-treemap');
        if (!canvas) {
            console.error('Canvas element not found');
            return;
        }

        const ctx = canvas.getContext('2d');

        if (canvas.chart) {
            canvas.chart.destroy();
        }

        // Check if treemap is available
        if (!Chart.controllers.treemap) {
            console.error('Treemap plugin not loaded');
            ctx.fillStyle = getTextColor();
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Treemap visualization requires additional plugin', canvas.width / 2, canvas.height / 2);
            return;
        }

        const serviceCounts = {};
        allPaths.forEach(path => {
            if (path.services) {
                path.services.forEach(service => {
                    if (service === 'iam' && path.category === 'new-passrole') {
                        return;
                    }
                    serviceCounts[service] = (serviceCounts[service] || 0) + 1;
                });
            }
        });

        const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);

        // Prepare treemap data - simplified structure
        const treemapData = sortedServices.map(([service, count], index) => ({
            service: service.toUpperCase(),
            count: count,
            colorIndex: index
        }));

        canvas.chart = new Chart(ctx, {
            type: 'treemap',
            data: {
                datasets: [{
                    tree: treemapData,
                    key: 'count',
                    groups: ['service'],
                    spacing: 2,
                    borderWidth: 3,
                    borderRadius: 6,
                    backgroundColor: function(ctx) {
                        if (!ctx.raw || !ctx.raw._data) return chartColors[0];
                        const index = ctx.raw._data.colorIndex || 0;
                        return chartColors[index % chartColors.length] + '99';
                    },
                    borderColor: function(ctx) {
                        if (!ctx.raw || !ctx.raw._data) return chartColors[0];
                        const index = ctx.raw._data.colorIndex || 0;
                        return chartColors[index % chartColors.length];
                    },
                    labels: {
                        display: true,
                        align: 'center',
                        position: 'middle',
                        color: '#ffffff',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        formatter: function(ctx) {
                            if (!ctx.raw || !ctx.raw._data) return '';

                            const service = ctx.raw._data.service;
                            const count = ctx.raw._data.count;
                            const width = ctx.raw.w || 100;

                            // Estimate characters that fit (roughly 8px per character at 14px font)
                            const charsPerLine = Math.floor(width / 8);

                            // Wrap service name if needed
                            const lines = [];
                            if (service.length > charsPerLine && charsPerLine > 3) {
                                // Split into multiple lines
                                let remaining = service;
                                while (remaining.length > 0) {
                                    if (remaining.length <= charsPerLine) {
                                        lines.push(remaining);
                                        break;
                                    }
                                    // Try to break at a good point (hyphen, underscore, or just split)
                                    let splitPoint = charsPerLine;
                                    const breakChars = ['-', '_', ' '];
                                    for (let i = charsPerLine; i > charsPerLine - 5 && i > 0; i--) {
                                        if (breakChars.includes(remaining[i])) {
                                            splitPoint = i + 1;
                                            break;
                                        }
                                    }
                                    lines.push(remaining.substring(0, splitPoint));
                                    remaining = remaining.substring(splitPoint);
                                }
                            } else {
                                lines.push(service);
                            }

                            // Add count on the last line
                            lines.push(count);
                            return lines;
                        }
                    }
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return context[0].raw._data?.service || '';
                            },
                            label: function(context) {
                                const count = context.raw._data?.count || 0;
                                return `${count} paths`;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error creating treemap:', error);
        // Don't let treemap error break the page
    }
}

// Create category distribution chart
function createCategoryChart() {
    const canvas = document.getElementById('category-chart');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    // Count paths per category
    const categoryCounts = {};
    allPaths.forEach(path => {
        const category = path.category;
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    const categoryLabels = {
        'self-escalation': 'Self-Escalation',
        'principal-access': 'Principal Access',
        'new-passrole': 'New PassRole',
        'existing-passrole': 'Existing PassRole',
        'credential-access': 'Credential Access'
    };

    const labels = Object.keys(categoryCounts).map(cat => categoryLabels[cat] || cat);
    const data = Object.values(categoryCounts);
    const colors = Object.keys(categoryCounts).map(cat => categoryColors[cat] || '#9d4edd');

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderColor: getTextColor(),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const percentage = Math.round((value / allPaths.length) * 100);
                            return `${label}: ${value} paths (${percentage}%)`;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'categoryLabels',
            afterDatasetsDraw: function(chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0);

                meta.data.forEach((arc, index) => {
                    const label = chart.data.labels[index];
                    const value = chart.data.datasets[0].data[index];
                    const percentage = Math.round((value / allPaths.length) * 100);

                    // Calculate position for label (middle of arc)
                    const angle = (arc.startAngle + arc.endAngle) / 2;
                    const radius = (arc.innerRadius + arc.outerRadius) / 2;
                    const x = arc.x + Math.cos(angle) * radius;
                    const y = arc.y + Math.sin(angle) * radius;

                    // Draw text
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 14px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    // Split label into multiple lines for better fit
                    const words = label.split(' ');
                    const lineHeight = 18;

                    if (words.length === 1) {
                        // Single word - just show word and count
                        ctx.fillText(words[0], x, y - lineHeight / 2);
                        ctx.fillText(`${value} (${percentage}%)`, x, y + lineHeight / 2);
                    } else {
                        // Multi-word - show each word on its own line, then count
                        const totalLines = words.length + 1;
                        const startY = y - (totalLines - 1) * lineHeight / 2;

                        words.forEach((word, i) => {
                            ctx.fillText(word, x, startY + i * lineHeight);
                        });
                        ctx.fillText(`${value} (${percentage}%)`, x, startY + words.length * lineHeight);
                    }
                });
            }
        }]
    });
}

// Create detection coverage ring chart (overview)
function createDetectionCoverageRing() {
    const canvas = document.getElementById('detection-coverage-ring');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    // Calculate coverage
    const pathsWithDetection = allPaths.filter(path =>
        path.detectionTools && Object.keys(path.detectionTools).length > 0
    ).length;
    const pathsWithoutDetection = allPaths.length - pathsWithDetection;

    const coveragePercentage = Math.round((pathsWithDetection / allPaths.length) * 100);
    const noCoveragePercentage = 100 - coveragePercentage;

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['With Detection', 'Without Detection'],
            datasets: [{
                data: [pathsWithDetection, pathsWithoutDetection],
                backgroundColor: ['#9d4edd', '#666666'],
                borderColor: getTextColor(),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const percentage = Math.round((value / allPaths.length) * 100);
                            return `${label}: ${value} paths (${percentage}%)`;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'doughnutLabels',
            afterDatasetsDraw: function(chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0);

                meta.data.forEach((arc, index) => {
                    const label = chart.data.labels[index];
                    const value = chart.data.datasets[0].data[index];
                    const percentage = Math.round((value / allPaths.length) * 100);

                    // Calculate position for label (middle of arc)
                    const angle = (arc.startAngle + arc.endAngle) / 2;
                    const radius = (arc.innerRadius + arc.outerRadius) / 2;
                    const x = arc.x + Math.cos(angle) * radius;
                    const y = arc.y + Math.sin(angle) * radius;

                    // Draw text
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 16px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';

                    // Split into three lines: "With/Without", "Detection", "X (Y%)"
                    const labelParts = label.split(' '); // Split "With Detection" or "Without Detection"
                    const line1 = labelParts[0]; // "With" or "Without"
                    const line2 = labelParts[1]; // "Detection"
                    const line3 = `${value} (${percentage}%)`;

                    ctx.fillText(line1, x, y - 20);
                    ctx.fillText(line2, x, y);
                    ctx.fillText(line3, x, y + 20);
                });
            }
        }]
    });
}

// Create detection tools breakdown chart
function createDetectionToolsChart() {
    const canvas = document.getElementById('detection-tools-chart');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    // Count paths detected by each tool
    const toolCounts = {};
    allPaths.forEach(path => {
        if (path.detectionTools) {
            Object.keys(path.detectionTools).forEach(tool => {
                toolCounts[tool] = (toolCounts[tool] || 0) + 1;
            });
        }
    });

    // Sort by count descending
    const sortedTools = Object.entries(toolCounts)
        .sort((a, b) => b[1] - a[1]);

    const labels = sortedTools.map(([tool]) => {
        // Capitalize first letter
        return tool.charAt(0).toUpperCase() + tool.slice(1);
    });

    const data = sortedTools.map(([_, count]) => count);

    // Create gradient backgrounds for modern look
    const gradients = labels.map((label, index) => {
        const gradient = ctx.createLinearGradient(0, 0, 400, 0);
        const baseColor = chartColors[index % chartColors.length];
        gradient.addColorStop(0, baseColor);
        gradient.addColorStop(1, baseColor + 'CC'); // Add transparency at end
        return gradient;
    });

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Paths Detected',
                data: data,
                backgroundColor: gradients,
                borderColor: 'transparent',
                borderWidth: 0,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const percentage = Math.round((context.parsed.x / allPaths.length) * 100);
                            return `${context.parsed.x} paths (${percentage}%)`;
                        }
                    }
                },
                datalabels: {
                    anchor: 'center',
                    align: 'center',
                    color: '#ffffff',
                    font: {
                        weight: 'bold',
                        size: 13
                    },
                    formatter: function(value, context) {
                        const label = context.chart.data.labels[context.dataIndex];
                        const plural = value === 1 ? 'Path' : 'Paths';
                        return `${label} (${value} ${plural})`;
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: getTextColor(),
                        stepSize: 5,
                        callback: function(value) {
                            // Convert count to percentage
                            return Math.round((value / allPaths.length) * 100) + '%';
                        }
                    },
                    grid: {
                        color: getGridColor()
                    }
                },
                y: {
                    display: false,
                    grid: {
                        display: false
                    }
                }
            },
            layout: {
                padding: {
                    left: 10,
                    right: 10,
                    top: 10,
                    bottom: 10
                }
            }
        },
        plugins: [{
            id: 'customLabels',
            afterDatasetsDraw: function(chart) {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const label = chart.data.labels[index];
                        const value = dataset.data[index];
                        const plural = value === 1 ? 'Path' : 'Paths';
                        const text = `${label} (${value} ${plural})`;

                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 16px sans-serif';
                        ctx.textAlign = 'right';
                        ctx.textBaseline = 'middle';

                        const x = bar.x - 15; // Right side with padding
                        const y = bar.y;

                        ctx.fillText(text, x, y);
                    });
                });
            }
        }]
    });
}

// Initialize relationship view switching
function initRelationshipViews() {
    const buttons = document.querySelectorAll('.view-toggle-btn');
    const views = document.querySelectorAll('.relationship-view');

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const targetView = button.dataset.view;

            // Update active button
            buttons.forEach(b => b.classList.remove('active'));
            button.classList.add('active');

            // Show/hide views
            views.forEach(view => {
                view.style.display = 'none';
            });
            document.getElementById(`relationships-${targetView}`).style.display = 'block';

            // Create visualization if not already created
            if (targetView === 'network' && !window.relationshipNetworkCreated) {
                createRelationshipNetwork();
                window.relationshipNetworkCreated = true;
            }
        });
    });
}

// Create parent/child relationship list display
function createRelationshipDisplay() {
    const container = document.getElementById('relationships-list');

    // Build parent-child map
    const parentChildMap = {};

    allPaths.forEach(path => {
        if (path.parent && path.parent.id) {
            const parentId = path.parent.id;
            if (!parentChildMap[parentId]) {
                parentChildMap[parentId] = [];
            }
            parentChildMap[parentId].push({
                id: path.id,
                name: path.name,
                modification: path.parent.modification || 'No description'
            });
        }
    });

    if (Object.keys(parentChildMap).length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No parent-child relationships found.</p>';
        return;
    }

    // Sort parent IDs
    const sortedParents = Object.keys(parentChildMap).sort();

    let html = '';
    sortedParents.forEach(parentId => {
        const parentPath = allPaths.find(p => p.id === parentId);
        const parentName = parentPath ? parentPath.name : parentId;
        const children = parentChildMap[parentId];

        html += `
            <div class="relationship-item">
                <div class="parent">
                    <span class="relationship-label">Primary:</span>
                    <a href="/paths/${parentId}" class="badge badge-primary">${parentId}</a>
                    <span class="path-name">${parentName}</span>
                </div>
                <div class="children">
                    ${children.map(child => `
                        <div class="variant-row">
                            <span class="relationship-label">Variant:</span>
                            <a href="/paths/${child.id}" class="badge badge-derivative">${child.id}</a>
                            <span class="path-name">${child.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Create network graph visualization
function createRelationshipNetwork() {
    const container = document.getElementById('network-container');

    // Build parent-child map
    const parentChildMap = {};
    allPaths.forEach(path => {
        if (path.parent && path.parent.id) {
            const parentId = path.parent.id;
            if (!parentChildMap[parentId]) {
                parentChildMap[parentId] = [];
            }
            parentChildMap[parentId].push(path);
        }
    });

    // Create nodes and edges for vis.js
    const nodes = [];
    const edges = [];
    const addedNodes = new Set();

    Object.keys(parentChildMap).forEach(parentId => {
        // Add parent node if not already added
        if (!addedNodes.has(parentId)) {
            const parentPath = allPaths.find(p => p.id === parentId);
            nodes.push({
                id: parentId,
                label: parentId,
                title: parentPath ? parentPath.name : parentId,
                color: {
                    background: '#7b2cbf',
                    border: '#5a189a',
                    highlight: { background: '#9d4edd', border: '#7b2cbf' }
                },
                size: 30,
                font: { color: '#ffffff', size: 14, bold: true }
            });
            addedNodes.add(parentId);
        }

        // Add variant nodes and edges
        parentChildMap[parentId].forEach(variant => {
            if (!addedNodes.has(variant.id)) {
                nodes.push({
                    id: variant.id,
                    label: variant.id,
                    title: variant.name,
                    color: {
                        background: '#c77dff',
                        border: '#9d4edd',
                        highlight: { background: '#e0aaff', border: '#c77dff' }
                    },
                    size: 20,
                    font: { color: '#ffffff', size: 12 }
                });
                addedNodes.add(variant.id);
            }

            edges.push({
                from: parentId,
                to: variant.id,
                arrows: 'to',
                color: { color: getTextColor(), opacity: 0.5 },
                width: 2,
                smooth: { type: 'cubicBezier' }
            });
        });
    });

    // Get theme colors
    const isLightTheme = document.documentElement.classList.contains('light-theme');
    const nodeFontColor = isLightTheme ? '#1a1a1a' : '#ffffff';
    const edgeFontColor = isLightTheme ? '#1a1a1a' : '#e5e5e5';
    const edgeLabelBg = isLightTheme ? 'rgba(255, 255, 255, 0.8)' : 'rgba(26, 26, 26, 0.8)';

    // Create vis.js network with attack visualization styling
    const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
    const options = {
        layout: {
            hierarchical: {
                enabled: true,
                direction: 'UD',
                sortMethod: 'directed',
                nodeSpacing: 180,
                levelSeparation: 220
            }
        },
        nodes: {
            shape: 'box',
            margin: 10,
            widthConstraint: {
                minimum: 100,
                maximum: 150
            },
            font: {
                size: 14,
                face: 'Arial',
                color: nodeFontColor
            },
            borderWidth: 2,
            shadow: true
        },
        edges: {
            arrows: {
                to: {
                    enabled: true,
                    scaleFactor: 1.2,
                    type: 'arrow'
                }
            },
            font: {
                size: 12,
                align: 'horizontal',
                color: edgeFontColor,
                strokeWidth: 0,
                background: edgeLabelBg
            },
            color: {
                color: '#848484',
                highlight: '#ff9900'
            },
            width: 2,
            smooth: {
                type: 'cubicBezier',
                forceDirection: 'vertical',
                roundness: 0.5
            }
        },
        physics: {
            enabled: false
        },
        interaction: {
            hover: true,
            tooltipDelay: 100,
            zoomView: true,
            dragView: true,
            dragNodes: true
        }
    };

    new vis.Network(container, data, options);
}

// Create hierarchy tree visualization
function createRelationshipTree() {
    const canvas = document.getElementById('tree-canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Build parent-child map
    const parentChildMap = {};
    allPaths.forEach(path => {
        if (path.parent && path.parent.id) {
            const parentId = path.parent.id;
            if (!parentChildMap[parentId]) {
                parentChildMap[parentId] = [];
            }
            parentChildMap[parentId].push(path);
        }
    });

    const parents = Object.keys(parentChildMap).sort();
    const levelHeight = canvas.height / (parents.length + 1);
    const primaryX = 100;
    const variantStartX = 400;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    parents.forEach((parentId, parentIndex) => {
        const parentY = levelHeight * (parentIndex + 1);
        const variants = parentChildMap[parentId];

        // Draw parent node
        ctx.fillStyle = '#7b2cbf';
        ctx.beginPath();
        ctx.arc(primaryX, parentY, 25, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(parentId, primaryX, parentY);

        // Draw variant nodes and connections
        const variantSpacing = Math.min(80, (canvas.width - variantStartX - 100) / variants.length);
        variants.forEach((variant, variantIndex) => {
            const variantX = variantStartX + variantIndex * variantSpacing;
            const variantY = parentY;

            // Draw connection line
            ctx.strokeStyle = getTextColor();
            ctx.globalAlpha = 0.3;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(primaryX + 25, parentY);
            ctx.lineTo(variantX - 15, variantY);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Draw variant node
            ctx.fillStyle = '#c77dff';
            ctx.beginPath();
            ctx.arc(variantX, variantY, 15, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px sans-serif';
            ctx.fillText(variant.id, variantX, variantY);
            ctx.font = '12px sans-serif';
        });
    });
}

// Create sunburst visualization
function createRelationshipSunburst() {
    const canvas = document.getElementById('sunburst-canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxRadius = Math.min(centerX, centerY) - 50;

    // Build parent-child map
    const parentChildMap = {};
    allPaths.forEach(path => {
        if (path.parent && path.parent.id) {
            const parentId = path.parent.id;
            if (!parentChildMap[parentId]) {
                parentChildMap[parentId] = [];
            }
            parentChildMap[parentId].push(path);
        }
    });

    const parents = Object.keys(parentChildMap);
    const anglePerParent = (2 * Math.PI) / parents.length;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    parents.forEach((parentId, parentIndex) => {
        const variants = parentChildMap[parentId];
        const startAngle = parentIndex * anglePerParent;
        const endAngle = startAngle + anglePerParent;
        const anglePerVariant = anglePerParent / variants.length;

        // Draw parent arc
        ctx.fillStyle = '#7b2cbf';
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, maxRadius * 0.5, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();

        // Draw parent label
        const parentAngle = startAngle + anglePerParent / 2;
        const parentLabelX = centerX + Math.cos(parentAngle) * maxRadius * 0.25;
        const parentLabelY = centerY + Math.sin(parentAngle) * maxRadius * 0.25;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(parentId, parentLabelX, parentLabelY);

        // Draw variant arcs
        variants.forEach((variant, variantIndex) => {
            const variantStartAngle = startAngle + variantIndex * anglePerVariant;
            const variantEndAngle = variantStartAngle + anglePerVariant;

            ctx.fillStyle = `hsl(${280 + variantIndex * 20}, 70%, 70%)`;
            ctx.beginPath();
            ctx.arc(centerX, centerY, maxRadius * 0.5, variantStartAngle, variantEndAngle);
            ctx.arc(centerX, centerY, maxRadius, variantEndAngle, variantStartAngle, true);
            ctx.closePath();
            ctx.fill();

            // Draw variant label (only if there's enough space)
            if (anglePerVariant > 0.1) {
                const variantAngle = variantStartAngle + anglePerVariant / 2;
                const variantLabelX = centerX + Math.cos(variantAngle) * maxRadius * 0.75;
                const variantLabelY = centerY + Math.sin(variantAngle) * maxRadius * 0.75;
                ctx.fillStyle = '#ffffff';
                ctx.font = '10px sans-serif';
                ctx.save();
                ctx.translate(variantLabelX, variantLabelY);
                ctx.rotate(variantAngle + Math.PI / 2);
                ctx.fillText(variant.id, 0, 0);
                ctx.restore();
            }
        });
    });
}

