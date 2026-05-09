import React from 'react';
import { View, Dimensions, StyleSheet } from 'react-native';
import Svg, { Rect, Line, G, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';

const { width } = Dimensions.get('window');

const AdvancedChart = ({ data, colors }) => {
  if (!data || data.length === 0) return null;

  const chartWidth = width - 40;
  const chartHeight = 240; // Increased height for better visibility
  const padding = { top: 30, bottom: 40, left: 50, right: 20 };
  const graphWidth = chartWidth - padding.left - padding.right;
  const graphHeight = chartHeight - padding.top - padding.bottom;

  // Calculate max steps, with 10% headroom
  const rawMax = Math.max(...data.map(d => d.steps), 0);
  const maxSteps = rawMax > 0 ? Math.ceil(rawMax * 1.1 / 1000) * 1000 : 5000;
  
  const yTicks = [0, maxSteps / 2, maxSteps];

  const barWidth = 18;
  const spacing = graphWidth / data.length;

  const formatYLabel = (val) => {
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return val.toString();
  };

  return (
    <View style={styles.container}>
      <Svg width={chartWidth} height={chartHeight}>
        <Defs>
          <LinearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity="1" />
            <Stop offset="1" stopColor={colors.primaryDark || colors.primary} stopOpacity="0.7" />
          </LinearGradient>
          <LinearGradient id="todayGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.accent || colors.secondary} stopOpacity="1" />
            <Stop offset="1" stopColor={colors.primary} stopOpacity="0.8" />
          </LinearGradient>
        </Defs>

        {/* Y Axis Grid Lines & Labels */}
        {yTicks.map((tick, i) => {
          const y = padding.top + graphHeight - (tick / maxSteps) * graphHeight;
          return (
            <G key={`y-${i}`}>
              <Line
                x1={padding.left}
                y1={y}
                x2={chartWidth - padding.right}
                y2={y}
                stroke={colors.border}
                strokeWidth="1"
                strokeDasharray={tick === 0 ? "" : "4, 4"}
              />
              <SvgText
                x={padding.left - 12}
                y={y + 4}
                fill={colors.subtext}
                fontSize="10"
                fontWeight="600"
                textAnchor="end"
              >
                {formatYLabel(tick)}
              </SvgText>
            </G>
          );
        })}

        {/* Bars and X Axis Labels */}
        {data.map((d, i) => {
          const x = padding.left + (i * spacing) + (spacing / 2);
          const barHeight = (d.steps / maxSteps) * graphHeight;
          const y = padding.top + graphHeight - barHeight;
          const isToday = i === data.length - 1 || d.day === "Today";

          return (
            <G key={`x-${i}`}>
              {/* Background Bar (Track) */}
              <Rect
                x={x - barWidth / 2}
                y={padding.top}
                width={barWidth}
                height={graphHeight}
                fill={colors.border}
                opacity={0.3}
                rx={barWidth / 2}
              />
              
              {/* Actual Data Bar */}
              <Rect
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 4)} // Show a tiny sliver even if 0 but active
                fill={`url(#${isToday ? 'todayGradient' : 'barGradient'})`}
                rx={barWidth / 2}
              />

              {/* Day Label */}
              <SvgText
                x={x}
                y={padding.top + graphHeight + 22}
                fill={isToday ? colors.text : colors.subtext}
                fontSize="11"
                fontWeight={isToday ? "bold" : "500"}
                textAnchor="middle"
              >
                {d.day}
              </SvgText>

              {/* Value on top (only for significant bars) */}
              {barHeight > 30 && (
                <SvgText
                  x={x}
                  y={y - 8}
                  fill={isToday ? colors.text : colors.subtext}
                  fontSize="8"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {d.steps > 1000 ? `${(d.steps / 1000).toFixed(1)}k` : d.steps}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
});

export default AdvancedChart;
