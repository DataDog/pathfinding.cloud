// Shared visualization functions used by both paths (app.js) and labs (labs.js)
// Extracted from app.js to avoid duplication

// Store tooltip positions per visualization container
const tooltipPositions = new WeakMap();

// Helper function to get a darker version of a color for borders
function getDarkerColor(hex) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const darkerR = Math.floor(r * 0.7);
    const darkerG = Math.floor(g * 0.7);
    const darkerB = Math.floor(b * 0.7);
    return `#${darkerR.toString(16).padStart(2, '0')}${darkerG.toString(16).padStart(2, '0')}${darkerB.toString(16).padStart(2, '0')}`;
}

// Calculate hierarchical levels for nodes based on edges
function calculateHierarchicalLevels(nodes, edges) {
    const levels = {};
    const nodeToLevel = {};

    // Find nodes with no incoming edges (root nodes)
    const incomingEdges = {};
    nodes.forEach(n => incomingEdges[n.id] = []);
    edges.forEach(e => {
        if (!incomingEdges[e.to]) incomingEdges[e.to] = [];
        incomingEdges[e.to].push(e.from);
    });

    // BFS to assign levels
    const queue = [];
    nodes.forEach(n => {
        if (incomingEdges[n.id].length === 0) {
            nodeToLevel[n.id] = 0;
            queue.push({ id: n.id, level: 0 });
        }
    });

    while (queue.length > 0) {
        const current = queue.shift();
        if (!levels[current.level]) levels[current.level] = [];
        levels[current.level].push(current.id);

        edges.forEach(e => {
            if (e.from === current.id && nodeToLevel[e.to] === undefined) {
                nodeToLevel[e.to] = current.level + 1;
                queue.push({ id: e.to, level: current.level + 1 });
            }
        });
    }

    return levels;
}

// Parse Mermaid "graph LR" format into vis.js nodes/edges
function parseMermaidGraph(mermaidCode) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    const nodeFontColor = '#232f3e';
    const lines = mermaidCode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'));
    const nodeStyles = new Map();

    // First pass: collect all style declarations so they're available when creating nodes
    lines.forEach(line => {
        if (line.startsWith('style ')) {
            const styleMatch = line.match(/style\s+(\w+)\s+fill:(#[0-9a-fA-F]+)/);
            if (styleMatch) {
                nodeStyles.set(styleMatch[1], styleMatch[2]);
            }
        }
    });

    // Second pass: process edges and create nodes
    lines.forEach(line => {
        if (line.startsWith('graph ') || line.startsWith('style ')) return;

        // Parse edge with label: A[label] -->|edge label| B[label]
        let edgeMatch = line.match(/(\w+)\[([^\]]+)\]\s*-->(?:\|([^|]+)\|)?\s*(\w+)\[([^\]]+)\]/);

        // Also try: B -->|label| C[label]
        if (!edgeMatch) {
            edgeMatch = line.match(/(\w+)\s*-->(?:\|([^|]+)\|)?\s*(\w+)\[([^\]]+)\]/);
            if (edgeMatch) {
                const [, fromId, edgeLabel, toId, toLabel] = edgeMatch;

                if (!nodeMap.has(toId)) {
                    const color = nodeStyles.get(toId) || '#e8f4f8';
                    nodes.push({
                        id: toId,
                        label: toLabel,
                        color: {
                            background: color,
                            border: getDarkerColor(color),
                            highlight: { background: color, border: '#ff9900' }
                        },
                        font: { size: 14, face: 'Arial', color: nodeFontColor }
                    });
                    nodeMap.set(toId, true);
                }

                edges.push({ from: fromId, to: toId, label: edgeLabel || '' });
                return;
            }
        }

        if (edgeMatch) {
            const [, fromId, fromLabel, edgeLabel, toId, toLabel] = edgeMatch;

            if (!nodeMap.has(fromId)) {
                const color = nodeStyles.get(fromId) || '#e8f4f8';
                nodes.push({
                    id: fromId,
                    label: fromLabel,
                    color: {
                        background: color,
                        border: getDarkerColor(color),
                        highlight: { background: color, border: '#ff9900' }
                    },
                    font: { size: 14, face: 'Arial', color: nodeFontColor }
                });
                nodeMap.set(fromId, true);
            }

            if (!nodeMap.has(toId)) {
                const color = nodeStyles.get(toId) || '#e8f4f8';
                nodes.push({
                    id: toId,
                    label: toLabel,
                    color: {
                        background: color,
                        border: getDarkerColor(color),
                        highlight: { background: color, border: '#ff9900' }
                    },
                    font: { size: 14, face: 'Arial', color: nodeFontColor }
                });
                nodeMap.set(toId, true);
            }

            edges.push({ from: fromId, to: toId, label: edgeLabel || '' });
        }
    });

    return { nodes, edges };
}

// Convert structured format to vis.js data
function convertStructuredToVisData(structured) {
    const nodeFontColor = '#232f3e';

    const nodes = structured.nodes.map(node => {
        const colorDefaults = {
            'principal': '#ff9999',
            'resource': '#ffcc99',
            'payload': '#99ccff',
            'action': '#99ccff',
            'outcome': '#99ff99'
        };

        if (node.type === 'outcome' && !node.color) {
            if (node.label.includes('No ') || node.label.includes('Dead')) {
                node.color = '#cccccc';
            } else if (node.label.includes('Check') || node.label.includes('Some')) {
                node.color = '#ffeb99';
            }
        }

        const color = node.color || colorDefaults[node.type] || '#e8f4f8';

        return {
            id: node.id,
            label: node.label,
            color: {
                background: color,
                border: getDarkerColor(color),
                highlight: { background: color, border: '#ff9900' }
            },
            description: node.description || '',
            font: { size: 14, face: 'Arial', color: nodeFontColor }
        };
    });

    const edges = structured.edges.map((edge, index) => {
        const edgeStyle = {
            id: `edge-${index}`,
            from: edge.from,
            to: edge.to,
            description: edge.description || '',
            originalLabel: edge.label
        };

        if (edge.branch || edge.condition) {
            edgeStyle.dashes = [5, 5];
            edgeStyle.color = { color: '#999', highlight: '#ff9900' };
        } else {
            edgeStyle.label = edge.label;
        }

        return edgeStyle;
    });

    return { nodes, edges };
}

// Render attack visualization into a container
// Accepts containerId (string) or container (element), and visualization data (mermaid string or structured object)
function renderAttackVisualization(containerOrId, visualization) {
    const container = typeof containerOrId === 'string'
        ? document.getElementById(containerOrId)
        : containerOrId;

    if (!container) return;

    try {
        let nodes, edges;

        if (typeof visualization === 'string') {
            const parsed = parseMermaidGraph(visualization);
            nodes = parsed.nodes;
            edges = parsed.edges;
        } else if (typeof visualization === 'object' && visualization.nodes && visualization.edges) {
            const converted = convertStructuredToVisData(visualization);
            nodes = converted.nodes;
            edges = converted.edges;
        } else {
            throw new Error('Invalid visualization format');
        }

        const isLightTheme = document.documentElement.classList.contains('light-theme');
        const nodeFontColor = '#232f3e';
        const edgeFontColor = isLightTheme ? '#666' : '#FFFFFF';
        const edgeLabelBg = isLightTheme ? 'rgba(255,255,255,0.9)' : 'rgba(26,26,36,0.9)';

        // Calculate hierarchical levels and position nodes
        const nodeSpacing = 250;
        const levelSeparation = 120;
        const levels = calculateHierarchicalLevels(nodes, edges);
        const levelNumbers = Object.keys(levels).map(Number).sort((a, b) => a - b);

        levelNumbers.forEach((levelNum, levelIndex) => {
            const nodesAtLevel = levels[levelNum];
            const y = levelIndex * levelSeparation;

            let centerX = 0;
            if (levelIndex > 0) {
                const prevLevelNum = levelNumbers[levelIndex - 1];
                const prevLevelNodes = levels[prevLevelNum];
                const prevLevelXPositions = prevLevelNodes.map(nodeId => {
                    const node = nodes.find(n => n.id === nodeId);
                    return node ? node.x : 0;
                });
                const prevLevelMinX = Math.min(...prevLevelXPositions);
                const prevLevelMaxX = Math.max(...prevLevelXPositions);
                centerX = (prevLevelMinX + prevLevelMaxX) / 2;
            }

            const currentLevelWidth = (nodesAtLevel.length - 1) * nodeSpacing;
            const startX = centerX - (currentLevelWidth / 2);

            nodesAtLevel.forEach((nodeId, index) => {
                const node = nodes.find(n => n.id === nodeId);
                if (node) {
                    node.x = startX + (index * nodeSpacing);
                    node.y = y;
                    node.fixed = true;
                }
            });
        });

        const data = { nodes, edges };
        const options = {
            layout: { hierarchical: false },
            nodes: {
                shape: 'box',
                margin: 10,
                widthConstraint: { minimum: 120, maximum: 200 },
                font: { size: 14, face: 'Arial', color: nodeFontColor },
                borderWidth: 2,
                shadow: true
            },
            edges: {
                arrows: { to: { enabled: true, scaleFactor: 1.2, type: 'arrow' } },
                font: {
                    size: 12,
                    align: 'horizontal',
                    color: edgeFontColor,
                    strokeWidth: 0,
                    background: edgeLabelBg,
                    multi: true
                },
                color: { color: '#848484', highlight: '#ff9900' },
                width: 2,
                length: 180,
                smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.5 }
            },
            physics: { enabled: false },
            interaction: { dragNodes: true, dragView: true, zoomView: false, hover: true }
        };

        const network = new vis.Network(container, data, options);

        // Zoom controls
        const zoomControls = document.createElement('div');
        zoomControls.className = 'viz-zoom-controls';
        zoomControls.innerHTML = `
            <button class="viz-zoom-btn viz-zoom-in" title="Zoom In">+</button>
            <button class="viz-zoom-btn viz-zoom-out" title="Zoom Out">&#8722;</button>
            <button class="viz-zoom-btn viz-zoom-reset" title="Reset Zoom">&#8857;</button>
        `;
        container.appendChild(zoomControls);

        zoomControls.querySelector('.viz-zoom-in').addEventListener('click', () => {
            network.moveTo({ scale: network.getScale() * 1.2 });
        });
        zoomControls.querySelector('.viz-zoom-out').addEventListener('click', () => {
            network.moveTo({ scale: network.getScale() * 0.8 });
        });
        zoomControls.querySelector('.viz-zoom-reset').addEventListener('click', () => {
            network.fit();
        });

        // Click handlers for nodes/edges
        network.on('click', function(params) {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                const node = nodes.find(n => n.id === nodeId);
                if (node && node.description) {
                    showVisualizationTooltip(node.label, node.description, container);
                }
            } else if (params.edges.length > 0) {
                const edgeId = params.edges[0];
                const edge = edges.find(e => e.id === edgeId);
                if (edge && edge.description) {
                    const title = edge.originalLabel || edge.label || 'Edge Details';
                    showVisualizationTooltip(title, edge.description, container);
                }
            }
        });

        // Legend
        const legend = document.createElement('div');
        legend.className = 'viz-legend';
        legend.innerHTML = `
            <div class="viz-legend-title">Legend</div>
            <div class="viz-legend-section">
                <div class="viz-legend-subtitle">Node Types</div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #ff9999;"></div>
                    <span>Principal (Users/Roles)</span>
                </div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #ffcc99;"></div>
                    <span>Resource</span>
                </div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #99ccff;"></div>
                    <span>Payload (Attacker Actions)</span>
                </div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #99ff99;"></div>
                    <div class="viz-legend-box" style="background-color: #ffeb99;"></div>
                    <div class="viz-legend-box" style="background-color: #cccccc;"></div>
                    <span>Outcomes</span>
                </div>
            </div>
            <div class="viz-legend-section">
                <div class="viz-legend-subtitle">Edge Types</div>
                <div class="viz-legend-item">
                    <svg width="40" height="2" style="margin-right: 8px;">
                        <line x1="0" y1="1" x2="40" y2="1" stroke="#848484" stroke-width="2"/>
                    </svg>
                    <span>Transitive Actions</span>
                </div>
                <div class="viz-legend-item">
                    <svg width="40" height="2" style="margin-right: 8px;">
                        <line x1="0" y1="1" x2="40" y2="1" stroke="#999" stroke-width="2" stroke-dasharray="5,5"/>
                    </svg>
                    <span>Potential Outcomes</span>
                </div>
            </div>
        `;
        container.appendChild(legend);

        if (window.innerWidth <= 768) {
            legend.classList.add('collapsed');
        }
        legend.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                legend.classList.toggle('collapsed');
            }
        });

        container._visNetwork = network;
        return network;

    } catch (error) {
        container.innerHTML = '<p style="color: #d13212;">Error rendering visualization</p>';
        return null;
    }
}

// Show tooltip for node/edge descriptions
// Uses renderMarkdown from the page context if available, otherwise basic escaping
function showVisualizationTooltip(title, description, vizContainer) {
    const existingTooltip = document.querySelector('.viz-tooltip');
    if (existingTooltip) existingTooltip.remove();

    // Use whichever markdown renderer is available
    const markdownRenderer = typeof renderMarkdown === 'function' ? renderMarkdown
        : typeof renderLabMarkdown === 'function' ? renderLabMarkdown
        : (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const escapeTitleHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const tooltip = document.createElement('div');
    tooltip.className = 'viz-tooltip';
    tooltip.innerHTML = `
        <div class="viz-tooltip-header">${escapeTitleHtml(title)}</div>
        <div class="viz-tooltip-body">${markdownRenderer(description)}</div>
        <div class="viz-tooltip-close">&times;</div>
    `;

    vizContainer.appendChild(tooltip);

    tooltip.style.position = 'absolute';
    const savedPosition = tooltipPositions.get(vizContainer);
    if (savedPosition) {
        tooltip.style.left = savedPosition.left;
        tooltip.style.top = savedPosition.top;
        tooltip.style.bottom = 'auto';
    } else {
        tooltip.style.left = '10px';
        tooltip.style.bottom = '10px';
        tooltip.style.top = 'auto';
    }

    // Drag functionality
    const header = tooltip.querySelector('.viz-tooltip-header');
    let isDragging = false;
    let dragJustEnded = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        const containerRect = vizContainer.getBoundingClientRect();
        let newX = e.clientX - containerRect.left - offsetX;
        let newY = e.clientY - containerRect.top - offsetY;
        const tooltipRect = tooltip.getBoundingClientRect();
        newX = Math.max(0, Math.min(newX, containerRect.width - tooltipRect.width));
        newY = Math.max(0, Math.min(newY, containerRect.height - tooltipRect.height));
        tooltip.style.left = newX + 'px';
        tooltip.style.top = newY + 'px';
        tooltip.style.bottom = 'auto';
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            dragJustEnded = true;
            header.style.cursor = 'grab';
            tooltipPositions.set(vizContainer, { left: tooltip.style.left, top: tooltip.style.top });
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setTimeout(() => { dragJustEnded = false; }, 150);
        }
    };

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.viz-tooltip-close')) return;
        isDragging = true;
        const rect = tooltip.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        header.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    tooltip.querySelector('.viz-tooltip-close').addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.remove();
    });

    setTimeout(() => {
        const closeHandler = (e) => {
            if (dragJustEnded || tooltip.contains(e.target)) return;
            tooltip.remove();
            document.removeEventListener('click', closeHandler);
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}
